'use strict';

// Minecraft's log4j config (logging.client in the version JSON) writes XML events to stdout:
// <log4j:Event logger="..." timestamp="..." level="INFO" thread="Render thread">
//   <log4j:Message><![CDATA[...]]></log4j:Message>
//   <log4j:Throwable><![CDATA[...]]></log4j:Throwable>   (optional)
// </log4j:Event>
// This streaming parser turns that (and any plain text in between) into {time, level, thread, text}.

const EVENT_OPEN = '<log4j:Event';
const EVENT_CLOSE = '</log4j:Event>';
const MAX_BUFFER = 1 << 20;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function attr(head, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(head);
  return m ? m[1].replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENTITIES[e]) : '';
}

function cdata(block, tag) {
  const m = new RegExp(`<log4j:${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></log4j:${tag}>`).exec(block);
  return m ? m[1] : '';
}

function plainLevel(line) {
  const m = /\b(FATAL|ERROR|WARN|INFO|DEBUG|TRACE)\b/.exec(line);
  return m ? m[1] : 'INFO';
}

class LogParser {
  constructor(onLine) {
    this.onLine = onLine;
    this.buf = '';
  }

  push(chunk) {
    this.buf += chunk;
    for (;;) {
      const open = this.buf.indexOf(EVENT_OPEN);
      if (open === -1) {
        // Emit complete plain lines; keep a possible partial "<log4j:Ev" tail for the next chunk.
        const nl = this.buf.lastIndexOf('\n');
        if (nl !== -1) {
          this.emitPlain(this.buf.slice(0, nl));
          this.buf = this.buf.slice(nl + 1);
        }
        if (this.buf.length > MAX_BUFFER) {
          this.emitPlain(this.buf);
          this.buf = '';
        }
        return;
      }
      if (open > 0) {
        this.emitPlain(this.buf.slice(0, open));
        this.buf = this.buf.slice(open);
        continue;
      }
      const close = this.buf.indexOf(EVENT_CLOSE);
      if (close === -1) {
        if (this.buf.length > MAX_BUFFER) {
          this.emitPlain(this.buf);
          this.buf = '';
        }
        return;
      }
      const block = this.buf.slice(0, close + EVENT_CLOSE.length);
      this.buf = this.buf.slice(close + EVENT_CLOSE.length);
      this.emitEvent(block);
    }
  }

  flush() {
    if (this.buf.trim()) this.emitPlain(this.buf);
    this.buf = '';
  }

  emitEvent(block) {
    const head = block.slice(0, block.indexOf('>') + 1);
    const ts = Number(attr(head, 'timestamp'));
    const level = attr(head, 'level') || 'INFO';
    const thread = attr(head, 'thread');
    let text = cdata(block, 'Message');
    const thrown = cdata(block, 'Throwable');
    if (thrown) text += `\n${thrown}`;
    this.onLine({ time: Number.isFinite(ts) && ts > 0 ? ts : Date.now(), level, thread, text: text.replace(/\s+$/, '') });
  }

  emitPlain(text) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.onLine({ time: Date.now(), level: plainLevel(line), thread: '', text: line });
    }
  }
}

module.exports = { LogParser };
