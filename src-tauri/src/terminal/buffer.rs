use std::collections::VecDeque;

const MAX_LINES: usize = 10_000;
const MAX_BYTES: usize = 1_024 * 1_024;

pub struct LineBuffer {
    lines: VecDeque<String>,
    partial: String,
    byte_count: usize,
}

impl LineBuffer {
    pub fn new() -> Self {
        Self {
            lines: VecDeque::new(),
            partial: String::new(),
            byte_count: 0,
        }
    }

    pub fn append(&mut self, data: &str) {
        for ch in data.chars() {
            if ch == '\n' {
                let line = std::mem::take(&mut self.partial);
                self.push_line(line);
            } else {
                self.partial.push(ch);
            }
        }
    }

    fn push_line(&mut self, line: String) {
        let bytes = line.len() + 1;
        self.lines.push_back(line);
        self.byte_count += bytes;
        while self.lines.len() > MAX_LINES || self.byte_count > MAX_BYTES {
            if let Some(removed) = self.lines.pop_front() {
                self.byte_count = self.byte_count.saturating_sub(removed.len() + 1);
            } else {
                break;
            }
        }
    }

    pub fn tail_lines(&self, count: usize) -> Vec<String> {
        let mut out: Vec<String> = self
            .lines
            .iter()
            .skip(self.lines.len().saturating_sub(count))
            .cloned()
            .collect();
        if !self.partial.is_empty() {
            if out.len() >= count && count > 0 {
                out.remove(0);
            }
            out.push(self.partial.clone());
        }
        out
    }

    #[allow(dead_code)]
    pub fn tail_text(&self, count: usize) -> String {
        self.tail_lines(count).join("\n")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_and_tail() {
        let mut buf = LineBuffer::new();
        buf.append("line1\nline2\n");
        assert_eq!(buf.tail_lines(10), vec!["line1", "line2"]);
    }

    #[test]
    fn partial_line_merge() {
        let mut buf = LineBuffer::new();
        buf.append("hel");
        buf.append("lo\n");
        assert_eq!(buf.tail_lines(10), vec!["hello"]);
    }

    #[test]
    fn ring_buffer_drops_old_lines() {
        let mut buf = LineBuffer::new();
        for i in 0..MAX_LINES + 50 {
            buf.append(&format!("line-{i}\n"));
        }
        let all = buf.tail_lines(MAX_LINES + 10);
        assert!(all.len() <= MAX_LINES);
        let tail = buf.tail_lines(1);
        assert_eq!(tail.len(), 1);
        assert!(tail[0].starts_with("line-"));
    }
}
