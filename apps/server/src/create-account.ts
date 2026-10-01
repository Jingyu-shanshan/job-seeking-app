// Creates the app's one account: `npm run auth:create-account -- <email>`. Public sign-up is
// disabled, so this is the only way in. It runs as its own process against DATABASE_URL after
// the migrations, and asks for the password in the terminal so it stays out of shell history.
import { parseArgs } from 'node:util';
import { createAccount } from './auth.ts';
import { loadConfig } from './config.ts';
import { createPool } from './db/pool.ts';

const {
  positionals: [email],
} = parseArgs({ allowPositionals: true });
if (!email) fail('Usage: npm run auth:create-account -- <email>');
if (!process.stdin.isTTY) fail('Run this in a terminal, it asks for the password.');

const config = loadConfig();
if (!config.databaseUrl || !config.authSecret) fail('DATABASE_URL is not set');

const password = await askHidden('Password: ');
if ((await askHidden('Repeat the password: ')) !== password) fail('The passwords differ.');

const pool = createPool(config.databaseUrl, (error) => console.error(error.message));
try {
  await createAccount(
    { ...config, pool, secret: config.authSecret },
    { email, name: email, password },
  );
  console.log(`Created the account ${email}. Sign in at ${config.appUrl}/login`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
} finally {
  await pool.end();
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Reads one line from the terminal without echoing it. */
function askHidden(question: string): Promise<string> {
  const { stdin, stderr } = process;
  return new Promise((resolve, reject) => {
    let value = '';
    const done = (error?: Error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return done();
        if (char === '\u0003') return done(new Error('Cancelled'));
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char;
      }
    };
    stderr.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.on('data', onData);
    stdin.resume();
  });
}
