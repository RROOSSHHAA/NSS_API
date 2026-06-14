const { google } = require('googleapis');
const path = require('path');
require('dotenv').config();

// Initialize Google Sheets API
const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, 'credentials.json'), // We will put the service account JSON here
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });

/**
 * Append a row to the Google Sheet
 * @param {Array} data - Array of values representing a single row
 */
async function appendToSheet(data) {
    try {
        const response = await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Sheet1!A:Z', // Assumes the first sheet is named Sheet1
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [data],
            },
        });
        console.log('✅ Google Sheet Updated successfully.');
        return response;
    } catch (err) {
        console.error('❌ Failed to update Google Sheet:', err.message);
        // We don't throw here to prevent the API from crashing if sheets fail
    }
}

module.exports = { appendToSheet };
