// Google Apps Script for syncing lead data from Google Sheets to AdTracker
// Add this to your Google Sheet: Extensions > Apps Script

const API_BASE_URL = "YOUR_API_URL_HERE"; // e.g., https://dgnomads-wcou.vercel.app
const API_USERNAME = "YOUR_USERNAME";
const API_PASSWORD = "YOUR_PASSWORD";

/**
 * Sync lead data from the active sheet to AdTracker
 * Sheet should have columns: Lead ID, First Name, Last Name, Email, Created Date, 
 * Lead Source, Last Modified Date, Lead Status, Disqualified Reason*, 
 * Number of Outbound Calls, Converted, Converted Date, Opportunity Name, Stage,
 * Closed Lost Reason, Full Address, Zip/Postal Code, Web Source & Campaign
 * Run this function from the Apps Script editor
 */
function syncLeadData() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  const data = sheet.getDataRange().getValues();
  
  // Skip header row
  const headers = data[0].map(h => String(h).toLowerCase().trim());
  const rows = data.slice(1);
  
  // Find column indices
  const colMap = {};
  headers.forEach((h, i) => {
    colMap[h] = i;
  });
  
  const requiredCols = ['email', 'lead status'];
  for (const col of requiredCols) {
    if (!headers.includes(col)) {
      throw new Error(`Sheet must have '${col}' column`);
    }
  }
  
  // Build lead data array
  const leads = [];
  for (const row of rows) {
    const lead = {
      crm_lead_id: getCellValue(row, colMap, 'lead id'),
      first_name: getCellValue(row, colMap, 'first name'),
      last_name: getCellValue(row, colMap, 'last name'),
      email: getCellValue(row, colMap, 'email'),
      phone: getCellValue(row, colMap, 'phone'), // if you have phone column
      created_date: getCellValue(row, colMap, 'created date'),
      lead_source: getCellValue(row, colMap, 'lead source'),
      last_modified_date: getCellValue(row, colMap, 'last modified date'),
      status: getCellValue(row, colMap, 'lead status'),
      disqualified_reason: getCellValue(row, colMap, 'disqualified reason'),
      outbound_calls: getCellValue(row, colMap, 'number of outbound calls'),
      converted: getCellValue(row, colMap, 'converted'),
      converted_date: getCellValue(row, colMap, 'converted date'),
      opportunity_name: getCellValue(row, colMap, 'opportunity name'),
      stage: getCellValue(row, colMap, 'stage'),
      closed_lost_reason: getCellValue(row, colMap, 'closed lost reason'),
      full_address: getCellValue(row, colMap, 'full address'),
      zip_code: getCellValue(row, colMap, 'zip/postal code'),
      web_source_campaign: getCellValue(row, colMap, 'web source & campaign')
    };
    
    // Only include leads with email or phone
    if (lead.email || lead.phone) {
      leads.push(lead);
    }
  }
  
  if (leads.length === 0) {
    Logger.log("No leads to sync");
    return;
  }
  
  // Send to API
  const auth = Utilities.base64Encode(`${API_USERNAME}:${API_PASSWORD}`);
  
  const response = UrlFetchApp.fetch(`${API_BASE_URL}/api/leads/sync-crm`, {
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
  Logger.log(`Sync complete: ${result.matched} matched, ${result.updated} updated, ${result.created} created`);
  
  // Log details
  for (const r of result.results) {
    if (r.error) {
      Logger.log(`Error: ${r.error} - ${JSON.stringify(r.data)}`);
    } else {
      Logger.log(`Lead ${r.lead_id}: ${r.action}`);
    }
  }
  
  return result;
}

function getCellValue(row, colMap, colName) {
  const colIndex = colMap[colName];
  if (colIndex === undefined) return null;
  const value = row[colIndex];
  if (value === "" || value === undefined) return null;
  return value;
}

/**
 * Create a menu item to run the sync
 * Add this to your spreadsheet's onOpen trigger
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("AdTracker Sync")
    .addItem("Sync Lead Data", "syncLeadData")
    .addToUi();
}

/**
 * Set up automatic sync on edit
 * Add this as an onEdit trigger
 */
function onEdit(e) {
  const sheet = e.source.getActiveSheet();
  const range = e.range;
  
  // Sync on any edit (you can restrict to specific columns if needed)
  if (range.getRow() > 1) {
    // Add a small delay to avoid rate limiting
    Utilities.sleep(1000);
    syncLeadData();
  }
}
