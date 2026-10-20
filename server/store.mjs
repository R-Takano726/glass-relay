import fs from "node:fs";
import path from "node:path";
export class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, "state.json");
    this.lock = path.join(dir, "service.lock");
    try {
      this.fd = fs.openSync(this.lock, "wx", 0o600);
      fs.writeSync(this.fd, String(process.pid));
    } catch {
      let pid;
      try {
        pid = Number(fs.readFileSync(this.lock, "utf8"));
        if (!Number.isInteger(pid) || pid <= 0) {
          const stale = new Error("Invalid lock owner");
          stale.code = "ESRCH";
          throw stale;
        }
        process.kill(pid, 0);
      } catch (e) {
        if (e.code === "ESRCH") {
          fs.unlinkSync(this.lock);
          this.fd = fs.openSync(this.lock, "wx", 0o600);
          fs.writeSync(this.fd, String(process.pid));
        } else throw new Error("サービスのロックを確認できません");
      }
      if (this.fd === undefined)
        throw new Error("このデータを使うRelayサービスは起動済みです");
    }
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT")
        throw new Error(
          "保存データを読み込めません。元のファイルを保持しています",
        );
      this.data = { history: [], hosts: [] };
    }
    // A crash between transport and acknowledgement must never cause an automatic retry.
    for (const r of this.data.history)
      if (r.status === "sending") r.status = "unknown";
    this.save();
  }
  save() {
    const tmp = path.join(this.dir, `state-${process.pid}.tmp`);
    const fd = fs.openSync(tmp, "w", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(this.data));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.file);
    try {
      const dir = fs.openSync(this.dir, "r");
      fs.fsyncSync(dir);
      fs.closeSync(dir);
    } catch {}
  }
  close() {
    try {
      fs.closeSync(this.fd);
      fs.unlinkSync(this.lock);
    } catch {}
  }
}
