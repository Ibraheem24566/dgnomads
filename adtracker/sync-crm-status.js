const { Pool } = require("pg");
require("dotenv").config();

// Status mapping from external CRM to leads table
const STATUS_MAPPING = {
  "Open": "new",
  "appointment set": "contacted",
  "pre-sale qualified": "qualified",
  "proposal": "qualified",
  "site assessment": "qualified",
  "closed won": "won",
  "closed lost": "lost"
};

async function syncCRMStatus() {
  const adtrackerPool = new Pool({
    connectionString: process.env.DATABASE_URL
  });

  // Connect to your external CRM database
  const crmPool = new Pool({
    connectionString: process.env.CRM_DATABASE_URL
  });

  try {
    console.log("Starting CRM status sync...");

    // Fetch leads from CRM database
    // Adjust this query based on your actual CRM table structure
    const crmLeads = await crmPool.query(`
      SELECT name, email, phone, status 
      FROM your_crm_leads_table
      WHERE updated_at > NOW() - INTERVAL '1 hour'
    `);

    console.log(`Found ${crmLeads.rows.length} leads in CRM`);

    let updated = 0;
    let matched = 0;

    for (const crmLead of crmLeads.rows) {
      const mappedStatus = STATUS_MAPPING[crmLead.status.toLowerCase()];
      if (!mappedStatus) {
        console.log(`Skipping unmapped status: ${crmLead.status}`);
        continue;
      }

      // Match lead by email or phone
      const { rows } = await adtrackerPool.query(
        `SELECT id, status FROM leads 
         WHERE email = $1 OR phone = $2 
         LIMIT 1`,
        [crmLead.email, crmLead.phone]
      );

      if (rows.length === 0) {
        console.log(`No match found for: ${crmLead.email} / ${crmLead.phone}`);
        continue;
      }

      matched++;
      const lead = rows[0];

      // Only update if status changed
      if (lead.status !== mappedStatus) {
        await adtrackerPool.query(
          `UPDATE leads 
           SET status = $1, updated_at = NOW()
           WHERE id = $2`,
          [mappedStatus, lead.id]
        );

        // Log the change to lead_edits
        await adtrackerPool.query(
          `INSERT INTO lead_edits (lead_id, field_name, old_value, new_value)
           VALUES ($1, 'status', $2, $3)`,
          [lead.id, lead.status, mappedStatus]
        );

        console.log(`Updated lead ${lead.id}: ${lead.status} → ${mappedStatus}`);
        updated++;
      }
    }

    console.log(`Sync complete: ${matched} matched, ${updated} updated`);

  } catch (err) {
    console.error("Sync failed:", err);
    process.exit(1);
  } finally {
    await adtrackerPool.end();
    await crmPool.end();
  }
}

syncCRMStatus();
