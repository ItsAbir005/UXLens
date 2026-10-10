const fs = require('fs');
let code = fs.readFileSync('extension/src/config.js', 'utf8');

const targetCacheLogic =     if (siteData && Date.now() - siteData.timestamp < 3600000) {
      if (siteData.failedAt) {
        const since = Date.now() - siteData.failedAt;
        const cooldown = siteData.reason === "network" ? 15000 : 60000;
        if (since < cooldown) {
          log("resolve_cooldown_skip", { origin, reason: siteData.reason, seconds_left: Math.ceil((cooldown - since) / 1000) });
          const e = new Error("Site resolution is on cooldown");
          e.code = "COOLED_DOWN";
          throw e;
        }
      } else if (siteData.projectId) {
        log("resolve_cache_hit", { origin, age_seconds: Math.floor((Date.now() - siteData.timestamp) / 1000) });
        return siteData;
      }
    };

const replacementCacheLogic =     if (siteData) {
      if (siteData.ingestionKey) {
        log("resolve_cache_hit", { origin, age_seconds: Math.floor((Date.now() - siteData.timestamp) / 1000) });
        return siteData;
      } else if (siteData.failedAt) {
        const since = Date.now() - siteData.failedAt;
        const cooldown = siteData.reason === "network" ? 15000 : (siteData.reason === 429 ? 60000 : 5000);
        if (since < cooldown) {
          log("resolve_cooldown_skip", { origin, reason: siteData.reason, seconds_left: Math.ceil((cooldown - since) / 1000) });
          const e = new Error("Site resolution is on cooldown");
          e.code = siteData.reason === 404 ? "NOT_REGISTERED" : "COOLED_DOWN";
          throw e;
        }
      } else if (!siteData.ingestionKey && !siteData.failedAt && siteData.checkedAt && Date.now() - siteData.checkedAt < 10000) {
        return siteData;
      }
    };

if (code.includes(targetCacheLogic.replace(/\r\n/g, '\n'))) {
  code = code.replace(targetCacheLogic.replace(/\r\n/g, '\n'), replacementCacheLogic);
} else if (code.includes(targetCacheLogic)) {
  code = code.replace(targetCacheLogic, replacementCacheLogic);
} else {
  console.log("Could not find targetCacheLogic");
}

const targetReturnLogic =     const { data } = await response.json();
    const resultData = {
      projectId: data.id,
      ingestionKey: data.ingestionKey,
      timestamp: Date.now()
    };;

const replacementReturnLogic =     const data = await response.json();
    const resultData = {
      projectId: data.id,
      ingestionKey: data.ingestionKey,
      timestamp: Date.now(),
      checkedAt: Date.now()
    };;

if (code.includes(targetReturnLogic.replace(/\r\n/g, '\n'))) {
  code = code.replace(targetReturnLogic.replace(/\r\n/g, '\n'), replacementReturnLogic);
} else if (code.includes(targetReturnLogic)) {
  code = code.replace(targetReturnLogic, replacementReturnLogic);
} else {
  console.log("Could not find targetReturnLogic");
}

fs.writeFileSync('extension/src/config.js', code);
console.log("Patched config.js");