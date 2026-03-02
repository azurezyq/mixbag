import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ejsPath = path.join(__dirname, '../views/index.ejs');

if (fs.existsSync(ejsPath)) {
    const content = fs.readFileSync(ejsPath, 'utf8');
    // Check for the specific malformed tag: <% -
    if (content.includes('<% -')) {
        danger("Detected malformed EJS tag '<% -' in " + ejsPath + ". Please remove the space: '<%-'");
        process.exit(1);
    }
    console.log("✅ EJS validation passed: No malformed tags detected.");
} else {
    console.warn("⚠️ Warning: index.ejs not found, skipping validation.");
}

function danger(msg) {
    console.error("\x1b[31m%s\x1b[0m", "ERROR: " + msg);
}
