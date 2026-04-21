/* ═══════════════════════════════════════════════════════════════
   AI Tools — Index
   Registers all CRM tools into the global registry.
   ═══════════════════════════════════════════════════════════════ */

import { toolRegistry } from '../tool-registry';
import { clientTools } from './clients';
import { jobTools } from './jobs';
import { invoiceTools } from './invoices';
import { billingTools } from './billing';
import { scheduleTools } from './schedule';
import { dashboardTools } from './dashboard';
import { leadTools } from './leads';
import { searchTools } from './search';

/**
 * Register all CRM tools. Call this once at app startup.
 */
export function registerAllTools(): void {
  toolRegistry.registerAll(clientTools);
  toolRegistry.registerAll(jobTools);
  toolRegistry.registerAll(invoiceTools);
  toolRegistry.registerAll(billingTools);
  toolRegistry.registerAll(scheduleTools);
  toolRegistry.registerAll(dashboardTools);
  toolRegistry.registerAll(leadTools);
  toolRegistry.registerAll(searchTools);
}
