import { build } from "esbuild";
await build({entryPoints:["worker/index.js"],outfile:"dist/server/index.js",bundle:true,format:"esm",platform:"browser",target:"es2022",legalComments:"eof"});
