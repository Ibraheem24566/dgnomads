// Google Ads Script to push performance data to our webhook
function main() {
  const WEBHOOK_URL = 'YOUR_WEBHOOK_URL_HERE'; // Replace with your actual deployed URL
  const SECRET = 'your-webhook-secret-here'; // Must match server

  // GAQL Query to get performance data
  const query = `
    SELECT
      campaign.name,
      metrics.clicks,
      metrics.cost_micros,
      metrics.impressions,
      segments.date
    FROM campaign
    WHERE segments.date DURING YESTERDAY
  `;

  const report = AdsApp.search(query);
  const data = [];

  while (report.hasNext()) {
    const row = report.next();
    data.push({
      campaign: row.campaign.name,
      clicks: row.metrics.clicks,
      cost: row.metrics.costMicros / 1000000,
      impressions: row.metrics.impressions,
      date: row.segments.date
    });
  }

  // Send data to webhook
  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      secret: SECRET,
      data: data
    })
  });
}