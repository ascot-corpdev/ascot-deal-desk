// Terminal prompts for the backup scripts. askHidden doesn't echo what's typed.
import readline from "node:readline";

export function ask(question) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); res(a); });
  });
}

export function askHidden(question) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let asked = false;
    rl._writeToOutput = (s) => { if (!asked) { rl.output.write(s); asked = true; } };   // show the question, hide the typing
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); res(a); });
  });
}
