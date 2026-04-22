import { stderr } from "node:process";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export async function withSpinner<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!stderr.isTTY) return fn();
  const started = Date.now();
  let frame = 0;
  const render = () => {
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    stderr.write(`\r${FRAMES[frame % FRAMES.length]} ${label} ${DIM}(${elapsed}s)${RESET}`);
    frame++;
  };
  render();
  const timer = setInterval(render, 100);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
    const clear = " ".repeat(label.length + 20);
    stderr.write(`\r${clear}\r`);
  }
}
