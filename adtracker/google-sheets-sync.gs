// Google Apps Script for syncing lead status from Google Sheets to AdTracker
// Add this to your Google Sheet: Extensions > Apps Script

const API_BASE_URL = "YOUR_API_URL_HERE"; // e.g., https://dgnomads-wcou.vercel.app
const API_USERNAME = "YOUR_USERNAME";
const API_PASSWORD = "YOUR_PASSWORD";

/**
 * Sync status updates from the active sheet to AdTracker
 * Sheet should have columns: Email, Phone, Status
 * Run this function from the Apps Script editor
 */
function syncLeadStatus() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  
  // Skip header row
  const headers = data[0];
  const rows = data.slice(1);
  
  // Find column indices
  const emailCol = headers.findIndex(h => h.toLowerCase() === 'email');
  const phoneCol = headers.findIndex(h => h.toLowerCase() === 'phone');
  const statusCol = headers.findIndex(h => h.toLowerCase() === 'status');
  
  if (emailCol === -1 && phoneCol === -1) {
    throw new Error("Sheet must have 'Email' and/or 'Phone' columns");
  }
  if (statusCol === -1) {
    throw new Error("Sheet must have a 'Status' column");
  }
  
  // Build lead data array
  const leads = [];
  for (const row of rows) {
    const email = row[emailCol] || "";
    const phone = row[phoneCol] || "";
    const status = row[statusCol] || "";
    
    if ((email || phone) && status) {
      leads.push({ email, phone, status });
    }
  }
  
  if (leads.length === 0) {
    Logger.log("No leads to sync");
    return;
  }
  
  // Send to API
  const auth = Utilities.base64Encode(`${API_USERNAME}:${API_PASSWORD}`);
  
  const response = UrlFetchApp.fetch(`${API_BASE_URL}/api/leads/sync-status`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${auth}`
    },
    payload: JSON.stringify({ leads }),
    muteHttpExceptions: true
  });
  
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();
  
  if (responseCode !== 200) {
    Logger.log(`Error: ${responseCode}`);
    Logger.log(responseBody);
    throw new Error(`API request failed: ${responseCode}`);
  }
  
  const result = JSON.parse(responseBody);
  Logger.log(`Sync complete: ${result.matched} matched, ${result.updated} updated`);
  
  // Log details
  for (const r of result.results) {
    if (r.error) {
      Logger.log(`Error: ${r.error} - ${JSON.stringify(r.data)}`);
    } else if (!r.unchanged) {
      Logger.log(`Updated lead ${r.lead_id}: ${r.old_status} → ${r.new_status}`);
    }
  }
  
  return result;
}

/**
 * Create a menu item to run the sync
 * Add this to your spreadsheet's onOpen trigger
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("AdTracker Sync")
    .addItem("Sync Status Updates", "syncLeadStatus")
    .addToUi();
}

/**
 * Set up automatic sync on edit
 * Add this as an onEdit trigger
 */
function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const range = e.range;
  
  // Only sync if editing the Status column
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const statusCol = headers.findIndex(h => h.toLowerCase() === 'status') + 1;
  
  if (range.getColumn() === statusCol && range.getRow() > 1) {
    // Add a small delay to avoid rate limiting
    Utilities.sleep(1000);
    syncLeadStatus();
  }
}
