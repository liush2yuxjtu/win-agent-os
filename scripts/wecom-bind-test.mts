import { upsertBinding, listBindingViews } from "../agent/lib/platform/web/bot-bindings/db";
const b = upsertBinding({
  platform: "wecom",
  name: "wecom-test-bot",
  botId: "aibGZaWjLlmd-xRJA1hrfiNUexwZrmd5vRS",
  secret: "mX2WCMxtBcm1PhLN3fAgYoyn8czOIs8ilvNtNmLnoSN",
});
console.log("绑定完成 id:", b.id, "| view:", JSON.stringify(listBindingViews("wecom")));
