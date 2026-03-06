import{readFileSync}from"fs";
const md=JSON.parse(readFileSync("C:/Dev/Frontend-Majordhome/_majordhome_spec.json","utf8"));
const pb=JSON.parse(readFileSync("C:/Dev/Frontend-Majordhome/_public_spec.json","utf8"));
const tables=["leads","sources","statuses","monthly_source_costs"];
for(const t of tables){
  console.log("\n=== "+t+" columns ===");
  const def=md.definitions?.[t];
  if(def?.properties){
    const req=def.required||[];
    for(const[c,i]of Object.entries(def.properties)){
      const parts=[c,i.format+"("+i.type+")",req.includes(c)?"NOT NULL":"nullable"];
      if(i.default\!==undefined)parts.push("default="+JSON.stringify(i.default));
      if(i.description)parts.push(i.description);
      if(i.maxLength)parts.push("maxLen="+i.maxLength);
      if(i.enum)parts.push("enum="+JSON.stringify(i.enum));
      console.log("  "+parts.join(" | "));
    }
  }else console.log("  NOT FOUND IN SCHEMA");
}
console.log("\n=== Public schema definitions ===");
const pubDefs=Object.keys(pb.definitions||{});
console.log(pubDefs.join(", "));
const pipe=pubDefs.filter(d=>d.includes("lead")||d.includes("source")||d.includes("status")||d.includes("cost")||d.includes("pipeline"));
console.log("\nPipeline-related in public:",pipe.length?pipe.join(", "):"NONE");