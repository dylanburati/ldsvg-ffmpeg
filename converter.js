#!/usr/bin/env node

const grace = (cb) => {
  try {
    return cb();
  } catch (err) {}
};

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const sharp = require("sharp");
const chalk = require("chalk");
const ffmpegPath =
  grace(() => require("ffmpeg-static")) ||
  fail("Missing dependency: ffmpeg-static");

const fs = require("fs");
const path = require("path");
let frameRate = 60;
let output = "video.mp4";
const argv = process.argv.slice(2);

const nonCommandIndices = [];
const outputIdx = argv.indexOf("-o");
if (outputIdx >= 0) {
  const success = grace(() => {
    output = argv[outputIdx + 1];
    return true;
  });
  if (!success) fail("Expected an arg after -o flag");
  nonCommandIndices.push(outputIdx + 1);
}
const rateIdx = argv.indexOf("-r");
if (rateIdx >= 0) {
  const success = grace(() => {
    frameRate = parseFloat(argv[rateIdx + 1], 10);
    return !Number.isNaN(frameRate);
  });
  if (!success) fail("Expected a number after -r flag");
  nonCommandIndices.push(rateIdx + 1);
}
const inputIdx =
  argv.findIndex(
    (e, i) => !nonCommandIndices.includes(i) && !/^-[a-zA-Z]$/.test(e)
  );
if (inputIdx < 0) {
  fail("Input argument is required");
}
const input = argv[inputIdx];
grace(() => fs.existsSync(path.dirname(output))) ||
  fail(`Output directory ${path.dirname(output)} does not exist`);

(async function () {
  const t0 = Date.now();
  let stream = process.stdin;
  if (input !== "-") {
    stream =
      grace(() => fs.createReadStream(input)) ||
      fail("Could not open " + input);
  }
  await fs.promises.mkdir(`tmpdir-${t0}`);
  const numLength = 6;
  const pngName = (i) =>
    path.join(
      `tmpdir-${t0}`,
      `frame-${String(i + 1).padStart(numLength, "0")}.png`
    );

  let inputs = [];
  let readState = {
    promise: null,
    resolve: null,
  };
  readState.promise = new Promise(
    (resolve) => (readState.resolve = resolve)
  ).then(() => {
    readState.fulfilled = true;
  });
  
  let numFinished = 0;
  const numWorkers = 60;
  const workerGroup = {
    promises: new Array(numWorkers).fill(0).map(_ => Promise.resolve()),
    numWorking: 0,
    enqueue(i, asyncTask) {
      const idx = i % this.promises.length;
      this.promises[idx] = this.promises[idx].then(async () => {
        this.numWorking++;
        await asyncTask();
        this.numWorking--;
      });
    },
  };
  workerGroup.enqueue = workerGroup.enqueue.bind(workerGroup);
  
  const updateInputs = (str, isEnd) => {
    const lastUnsubmitted = Math.max(0, inputs.length - 1);
    const lines = str.split("\n");
    if (inputs.length) {
      inputs[inputs.length - 1] += lines[0];
    } else {
      inputs.push(lines[0]);
    }
    inputs.push(...lines.slice(1));

    const submitUntil = inputs.length - (isEnd ? 0 : 1);
    for (let i = lastUnsubmitted; i < submitUntil; i++) {
      if (inputs[i] !== "") {
        workerGroup.enqueue(i, () =>
          sharp(Buffer.from(inputs[i]))
            .png()
            .toFile(pngName(i))
            .then(() => {
              inputs[i] = null;
              numFinished++;
            })
        );
      }
    }
  };

  stream.on("data", (data) => {
    updateInputs("" + data);
  });
  stream.on("end", (data) => {
    updateInputs(data ? "" + data : "", true);
    readState.resolve();
  });

  console.error('Converting SVG -> PNG');
  let prevNumFinished = 0;
  const drawProgress = () => {
    if (!process.stderr.isTTY) return;
    const cols = process.stderr.columns - 1;
    const denom = inputs.filter(s => s !== "").length
    let str = `${numFinished} / ${denom}`;
    if (numFinished < denom && readState.fulfilled) {
      const secs = Math.round((denom - numFinished) * 2 / (numFinished - prevNumFinished));
      const endStr = `${Math.floor(secs / 60)}m ${secs % 60}s`.replace('0m ', '');
      str += ' '.repeat(Math.max(0, cols - str.length - endStr.length)) + endStr;
    } else {
      str += ' '.repeat(Math.max(0, cols - str.length));
    }
    const fillCols = Math.round(cols * numFinished / denom);
    process.stderr.cursorTo(0);
    process.stderr.write(chalk.inverse(str.slice(0, fillCols)) + str.slice(fillCols));
    process.stderr.clearLine(1);
    prevNumFinished = numFinished;
  };
  const intervalId = setInterval(drawProgress, 2000);
  await readState.promise;
  await Promise.all(workerGroup.promises);
  clearInterval(intervalId);
  drawProgress();
  console.error(`\n${numFinished} pngs in ${(Date.now() - t0) / 1000} s`);

  const formatStr = `tmpdir-${t0}/frame-%0${numLength}d.png`;
  const spawn = require("child_process").spawn;
  const ffmpeg = spawn(ffmpegPath, [
    "-nostdin",
    "-hide_banner",
    "-r",
    `${frameRate}`,
    "-i",
    formatStr,
    output
  ]);
  ffmpeg.stdout.on("data", (data) => {
    console.log("" + data);
  });
  ffmpeg.stderr.on("data", (data) => {
    console.log("" + data);
  });
  let exitCallback;
  ffmpeg.on("close", (code) => {
    exitCallback(code);
    console.log("ffmpeg exited with code " + code);
  });
  const ffExit = await new Promise((resolve) => (exitCallback = resolve));

  if (ffExit === 0) {
    await fs.promises.rmdir(`tmpdir-${t0}`, { recursive: true });
  } else {
    console.log(`leaving contents of ./tmpdir-${t0}`);
  }

  process.exit(0);
})();
