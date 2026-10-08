import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoonvyClient } from "../src/moonvy-client.js";
import { adaptGenome } from "../src/moonvy-genome.js";
import { normalizeToUiTree, fixtureBundle } from "../src/normalize.js";
import { downloadAssets } from "../src/assets.js";
import type { PipelineWarning } from "../src/types.js";

/** Synthetic official-format fixture isolates adaptation from private project data. */
const genome = JSON.parse(await readFile(new URL("../fixtures/genome-sample.json", import.meta.url), "utf8"));
/** Temporary output directories are removed after every test. */
const dirs: string[] = [];
/** Creates a writable output directory without touching user artifacts. */
async function directory() { const dir = await mkdtemp(join(tmpdir(), "moonvy-test-")); dirs.push(dir); return dir; }
/** Official route and fake session are safe test constants. */
const url = "https://moonvy.com/project/p/f/i";
/** Test-only session values are checked for leakage, never actual browser credentials. */
const credentials = { authorization: "Bearer private-test-token", cookie: "private-cookie", source: "env" as const };
afterEach(async () => { vi.unstubAllGlobals(); await Promise.all(dirs.splice(0).map(dir => rm(dir, {recursive:true, force:true}))); });

describe("Genome adapter", () => {
  it("retains frame-relative geometry through groups, typography, alpha, corners and visibility", () => {
    const tree = normalizeToUiTree(fixtureBundle("genome", genome));
    expect(tree.meta.canvas).toEqual({width:375,height:812});
    const card = tree.tree.children[0], title = card.children[0].children[0];
    expect(tree.tree.children).toHaveLength(1);
    expect(tree.tree.type).toBe("frame");
    expect(card.type).toBe("frame");
    expect(title.type).toBe("text");
    expect(card.style?.radius).toEqual([12,12,10,10]);
    expect(title.bounds).toEqual({x:36,y:200,width:120,height:22});
    expect(title.relative.x).toBe(8);
    expect(title.text).toMatchObject({content:"姥姥家的空调",fontFamily:"PingFang SC",fontSize:16,fontWeight:500,lineHeight:22,color:"rgba(0,0,0,0.8)",layout:{sizing:"intrinsic",overflow:"reflow"}});
  });
  it.each([["px",22,22],["percent",120,"120%"],["em",1.4,"1.4em"],["auto",0,undefined]])("retains explicit typography units %s and named font weight", (unit,value,expected) => {
    const input=structuredClone(genome);
    const segment=input.pages[0].children[0].children[0].children[0].textbox.segments[0];
    delete segment.fontWeight;
    segment.fontName.style="Semibold";
    segment.lineHeight={unit,value};
    const tree=normalizeToUiTree(fixtureBundle("g",input));
    const text=tree.tree.children[0].children[0].children[0].text;
    expect(text?.fontWeight).toBe(600);
    expect(text?.lineHeight).toBe(expected);
  });
  it("uses real slice pixel dimensions and supplied density instead of the containing layer", async () => {
    const warnings: PipelineWarning[] = [];
    const source = adaptGenome(genome,warnings);
    const bytes = await sharp({create:{width:72,height:66,channels:4,background:"red"}}).png().toBuffer();
    const assets = await downloadAssets(source,await directory(),[],warnings,async()=>bytes);
    expect(assets[0]).toMatchObject({name:"空调",size:{width:24,height:22}});
    expect(assets[0].variants.map(v=>[v.scale,v.width,v.height])).toEqual([[1,24,22],[2,48,44],[3,72,66]]);
    expect(warnings).toEqual([]);
  });
  it("resolves linked fills, gradients and project asset renames without mutating raw Genome", () => {
    const input = structuredClone(genome);
    input.styles={fills:[{id:"gradient",data:[{gradient:{type:"linear",from:{x:0,y:0},to:{x:1,y:0},stops:[{position:0,color:{r:255,g:0,b:0,alpha:0}},{position:1,color:{r:0,g:0,b:255,alpha:1}}]}}]}]};
    input.pages[0].fillLink="gradient";
    const before=JSON.stringify(input);
    const tree=normalizeToUiTree({...fixtureBundle("g",adaptGenome(input,[],undefined,{icon:"冷气"})),sourceType:"genome"});
    expect(tree.tree.style?.fill).toContain("linear-gradient(90deg");
    expect(tree.tree.style?.fill).toContain("rgba(255,0,0,0)");
    expect(tree.tree.children[0].children[0].children[1].name).toBe("冷气");
    expect(JSON.stringify(input)).toBe(before);
  });
  it("does not claim high confidence for unsupported transforms and mixed text", () => {
    const input=structuredClone(genome); input.pages[0].transform={rotate:45};
    const tree=normalizeToUiTree(fixtureBundle("g",input));
    expect(tree.meta.confidence).toBe("medium");
    expect(tree.warnings.some(w=>w.code==="GENOME_TRANSFORM_REFERENCE")).toBe(true);
  });
  it("rejects empty or invalid Genome instead of producing a fabricated high-confidence design", () => {
    expect(()=>adaptGenome({pages:[]},[])).toThrow();
    expect(()=>adaptGenome({pages:[{}]},[])).toThrow();
  });
});

describe("Moonvy client", () => {
  it.each([true,false])("fetches official metadata, isolates credentials and honors downloads=%s", async enabled => {
    const requests: Array<{url:string,headers:Headers,method?:string,body?:BodyInit|null}>=[];
    const png=await sharp({create:{width:72,height:66,channels:4,background:"red"}}).png().toBuffer();
    vi.stubGlobal("fetch",vi.fn(async (input:string,init:RequestInit)=>{
      requests.push({url:input,headers:new Headers(init.headers),method:init.method,body:init.body});
      expect(init.redirect).toBe("error");
      if(input.endsWith("/anynode/get")) return Response.json({id:"i",files:{genome:{url:"https://cdn.example/genome"}}});
      if(input.includes("project-info")) return Response.json({disk:"disk-id"});
      if(input.endsWith("/genome")) return Response.json(genome);
      return new Response(new Uint8Array(png));
    }));
    const out=await directory(), bundle=await new MoonvyClient(credentials).fetchSources(url,out,enabled);
    expect(bundle.sourceType).toBe("genome");
    expect(bundle.assets?.length).toBe(enabled?1:undefined);
    expect(JSON.parse(String(requests[0].body))).toEqual({projectId:"p",id:"i",lv:"full"});
    expect(requests[0].headers.get("authorization")).toBe(credentials.authorization);
    for(const request of requests.filter(r=>r.url.startsWith("https://cdn.example"))) {
      expect(request.headers.has("authorization")).toBe(false); expect(request.headers.has("cookie")).toBe(false);
    }
    expect(JSON.stringify(bundle)).not.toContain("private-test-token");
    expect(await readFile(join(out,"raw/item.json"),"utf8")).not.toContain("private-test-token");
  });
  it.each([401,403,500])("fails mandatory metadata with HTTP %s", async status => {
    vi.stubGlobal("fetch",vi.fn(async()=>new Response("private-test-token",{status})));
    await expect(new MoonvyClient(credentials).fetchSources(url,await directory())).rejects.toMatchObject({exitCode:4});
  });
  it.each([{error:{message:"secret"}},{status:401,message:"secret"},{id:"wrong"},null])("rejects business errors and missing items", async response => {
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json(response)));
    await expect(new MoonvyClient(credentials).fetchSources(url,await directory())).rejects.toMatchObject({exitCode:4});
  });
  it("keeps valid preview fallback dimensions and low confidence when Genome is absent", async()=>{
    const png=await sharp({create:{width:750,height:1624,channels:4,background:"red"}}).png().toBuffer();
    vi.stubGlobal("fetch",vi.fn(async(input:string)=>input.endsWith("/anynode/get") ? Response.json({id:"i",preview:{normal:"https://cdn.example/preview"},meta:{designInfo:{w:375,h:812}}}) : input.includes("project-info") ? Response.json({}) : new Response(new Uint8Array(png))));
    const bundle=await new MoonvyClient(credentials).fetchSources(url,await directory());
    expect(normalizeToUiTree(bundle).meta).toMatchObject({canvas:{width:375,height:812},confidence:"low"});
  });
  it("fails when neither structure nor valid preview exists",async()=>{
    vi.stubGlobal("fetch",vi.fn(async()=>Response.json({id:"i"})));
    await expect(new MoonvyClient(credentials).fetchSources(url,await directory())).rejects.toMatchObject({code:"MOONVY_DESIGN_UNAVAILABLE"});
  });
});
