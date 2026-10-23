// Prints the connection string the dashboard shows/copies, using the real connection.ts from <root>
const path=require("path"),fs=require("fs"),vm=require("vm");const root=process.argv[2];
const ts=require(path.join(root,"dashboard/node_modules/typescript"));
const load=(p,imp={})=>{const o=ts.transpileModule(fs.readFileSync(path.join(root,p),"utf8"),{compilerOptions:{module:1,target:4}}).outputText;const e={};vm.runInNewContext(o,{exports:e,require:i=>imp[i]});return e;};
const engines=load("dashboard/src/lib/engines.ts");const {connectionString}=load("dashboard/src/lib/connection.ts",{"@/lib/engines":engines});
process.stdout.write(connectionString({engine:"postgres",appName:"pgdemo",name:"pgdemo",databaseUser:"app",databasePassword:"p@ss:w/rd#1",databaseName:"appdb"}));
