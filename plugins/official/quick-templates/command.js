const languages = {
  en: {
    titleError: "Enter a single-line title without control characters.",
    templates: {
      meeting_notes: {
        title: "Meeting notes",
        body: `**Date:**

**Attendees:**

## Agenda

## Decisions

## Action items

- [ ] Task (owner, due date)
`
      },
      reading_notes: {
        title: "Reading notes",
        body: `**Author:**

## Key ideas

## Quotes and page numbers

## Reflections
`
      },
      daily_journal: {
        title: "Daily journal",
        body: `**Date:**

## What happened

## Reflections

## Tomorrow
`
      }
    }
  },
  zh_hans: {
    titleError: "请输入单行标题，标题中不能包含控制字符。",
    templates: {
      meeting_notes: {
        title: "会议纪要",
        body: `**日期：**

**参会人：**

## 议题

## 决议

## 待办事项

- [ ] 事项（负责人、截止日期）
`
      },
      reading_notes: {
        title: "读书笔记",
        body: `**作者：**

## 要点

## 摘录与页码

## 读后感
`
      },
      daily_journal: {
        title: "日记",
        body: `**日期：**

## 今日记录

## 回顾

## 明日计划
`
      }
    }
  },
  ja: {
    titleError: "改行や制御文字を含まない、1 行のタイトルを入力してください。",
    templates: {
      meeting_notes: {
        title: "議事録",
        body: `**日付：**

**出席者：**

## 議題

## 決定事項

## 対応事項

- [ ] タスク（担当者、期限）
`
      },
      reading_notes: {
        title: "読書ノート",
        body: `**著者：**

## 要点

## 引用とページ番号

## 感想
`
      },
      daily_journal: {
        title: "日記",
        body: `**日付：**

## 今日の出来事

## 振り返り

## 明日の予定
`
      }
    }
  }
};

/** @param {SnapshotV2} snapshot @returns {CommandResultV2} */
function run(snapshot) {
  const {template, language, title} = snapshot.params;
  const localized = languages[language];
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(title)) {
    return {kind: "error", code: "unsupported-input", message: localized.titleError};
  }

  const note = localized.templates[template];
  const heading = title.trim().replace(/[\\`*_{}\[\]<>#!|~=$^&]/g, character => "\\" + character) || note.title;
  const text = "# " + heading + "\n\n" + note.body;
  const firstLineEnding = /\r?\n/.exec(snapshot.text);
  return {kind: "text", text: firstLineEnding?.[0] === "\r\n" ? text.replace(/\n/g, "\r\n") : text};
}
