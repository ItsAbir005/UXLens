const puppeteer = require('puppeteer');
const path = require('path');
const EXTENSION_PATH = path.resolve(__dirname, 'extension');

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`] });
  const targets = await browser.targets();
  const bgTarget = targets.find(t => t.type() === 'service_worker');
  
  if (bgTarget) {
    const worker = await bgTarget.worker();
    
    // Evaluate and return a string!
    const res = await worker.evaluate(async () => {
      let logs = [];
      const originalLog = console.log;
      const originalError = console.error;
      console.log = (...args) => { logs.push(args.join(' ')); originalLog(...args); };
      console.error = (...args) => { logs.push(args.join(' ')); originalError(...args); };
      
      try {
        await globalThis.UXLensTestConnection();
      } catch (e) {
        logs.push("ERROR: " + e.message);
      }
      return logs;
    });
    console.log("Returned Logs:", res);
  }
  await browser.close();
})();