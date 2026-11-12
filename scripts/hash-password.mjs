// Prints a password hash for ADMIN_PASSWORD_HASH: node scripts/hash-password.mjs <password>
import { hashPassword } from '../netlify/lib/auth.mjs';
if (!process.argv[2]) { console.error('usage: node scripts/hash-password.mjs <password>'); process.exit(1); }
console.log(hashPassword(process.argv[2]));
