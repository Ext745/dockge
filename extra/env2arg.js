#!/usr/bin/env node

import childProcess from "child_process";

let env = process.env;

let cmd = process.argv[2];
let args = process.argv.slice(3);
let replacedArgs = [];

for (let arg of args) {
    for (let key in env) {
        arg = arg.replaceAll(`$${key}`, env[key]);
    }
    replacedArgs.push(arg);
}

let child = childProcess.spawn(cmd, replacedArgs);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);

// Without this the script always exits 0, so a failed `docker buildx build --push` looks like success
child.on("error", (err) => {
    console.error(err.message);
    process.exitCode = 1;
});
child.on("close", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
});
