import "dotenv/config";

/**
 * Runs every active automation once, then exits. Point cron at this if you would
 * rather not expose the HTTP endpoint:
 *
 *   0 9 * * *  cd /path/to/app && npm run automations:run
 */
const { runAutomations } = await import("../lib/actions/automations");

const result = await runAutomations();
console.log(result);
process.exit(result.ok ? 0 : 1);
