import React from "react";

export type Lang = "zh" | "en" | "es";

export interface SiteContent {
  htmlLang: string;
  docTitle: string;
  metaDescription: string;
  ogDescription: string;
  nav: { links: { label: string; href: string }[]; cta: string };
  hero: {
    badge: string;
    l1: string;
    l2pre: string;
    l2hi: string;
    tagline: string;
    subtitle: string;
    ctaPrimary: string;
    ctaSecondary: string;
    chips: string[];
    scroll: string;
  };
  marquee: string[];
  features: {
    badge: string;
    pre: string;
    hi: string;
    subtitle: string;
    items: { title: string; desc: string; tag: string }[];
  };
  copilot: {
    badge: string;
    l1: string;
    l2pre: string;
    l2hi: string;
    subtitle: string;
    bullets: string[];
    windowTitle: string;
    windowStatus: string;
    userMsg: string;
    botMsg: string;
    draftTitle: string;
    steps: { label: string; detail: string }[];
    accept: string;
    dryrun: string;
    costNote: string;
  };
  workflows: {
    badge: string;
    pre: string;
    hi: string;
    subtitle: string;
    items: { scene: string; title: string; persona: string; quote: string; steps: string[]; cost: string }[];
  };
  modes: {
    badge: string;
    pre: string;
    hi: string;
    subtitle: string;
    favorite: string;
    note: string;
    items: { level: string; name: string; slogan: string; desc: string; fit: string; points: string[] }[];
  };
  governance: {
    badge: string;
    pre: string;
    hi: string;
    subtitle: string;
    bubbleQuote: string;
    items: { title: string; desc: string }[];
  };
  integrations: {
    badge: string;
    pre: string;
    hi: string;
    subtitle: string;
    socialTitle: string;
    socialSub: string;
    adsLabel: string;
    saasTitle: string;
    saasSub: string;
    saas: { name: string; c: string }[];
    devNote: string;
  };
  pricing: {
    badge: string;
    pre: string;
    hi: string;
    post: string;
    subtitle: string;
    bannerPre: string;
    bannerHi: string;
    bannerPost: string;
    recommended: string;
    trialNote: string;
    per: string;
    plans: { name: string; cn: string; price: string; target: string; accounts: string; tasks: string; features: string[]; cta: string }[];
    overageTitle: string;
    overage: React.ReactNode[];
    taskTitle: string;
    taskRules: React.ReactNode[];
  };
  faq: {
    badge: string;
    pre: string;
    hi: string;
    post: string;
    items: { q: string; a: string }[];
  };
  footer: {
    l1: string;
    l2pre: string;
    l2hi: string;
    tagline: string;
    sub: string;
    signupFormTitle: string;
    columns: { title: string; links: string[] }[];
    copyright: string;
    madeWith: string;
  };
}

const zh: SiteContent = {
  htmlLang: "zh-CN",
  docTitle: "Piggybot — 你的营销运营数字分身",
  metaDescription: "Piggybot 是你在营销运营领域的数字分身。说一句人话，精灵分身就会把内容生成、审批、多平台发布、评论私信、线索同步串成自动化工作流。",
  ogDescription: "说一句人话，精灵分身替你打理营销运营。",
  nav: {
    links: [
      { label: "精灵能力", href: "#features" },
      { label: "咒语演示", href: "#copilot" },
      { label: "工作流剧场", href: "#workflows" },
      { label: "修行模式", href: "#modes" },
      { label: "安心结界", href: "#governance" },
      { label: "精灵集市", href: "#integrations" },
      { label: "价目灯笼", href: "#pricing" },
    ],
    cta: "免费召唤",
  },
  hero: {
    badge: "营销运营数字分身 · 会干活的 AI 精灵天团",
    l1: "把营销运营",
    l2pre: "交给",
    l2hi: "会飞的小精灵",
    tagline: "your digital twin for marketing ops",
    subtitle:
      "Piggybot 是你在营销运营领域的数字分身。不用写代码，说一句人话，分身们就会把「内容生成 → 审批 → 多平台发布 → 评论私信 → 线索入库 → 复盘报告」串成一条自己流动的小河。",
    ctaPrimary: "免费召唤精灵",
    ctaSecondary: "看工作流剧场",
    chips: ["15+ 社交平台一站连通", "6 大广告平台", "4 大场景模板", "每个动作都可审批"],
    scroll: "向下滚动，进入精灵村",
  },
  marquee: [
    "内容一变多",
    "评论变线索",
    "每周增长报告",
    "广告守护",
    "统一收件箱",
    "社交日历",
    "自然语言建流",
    "审批与回滚",
    "任务精灵计费",
    "品牌声音记忆",
  ],
  features: {
    badge: "精灵的六种超能力",
    pre: "你负责创意，",
    hi: "杂活交给精灵",
    subtitle: "从一条内容到一整个增长闭环，Piggybot 把繁琐的平台对接全部藏在幕后——你看到的只有业务场景和结果。",
    items: [
      {
        title: "可视化 Flow Builder",
        desc: "像拼积木一样连接 Trigger、Condition、Action、AI 与审批节点。看到的是业务场景和结果，不是 API 接口。",
        tag: "No-code 画布",
      },
      {
        title: "AI Copilot 建造者",
        desc: "说一句人话，精灵为你生成工作流草图，并一步一步解释它打算怎么做。",
        tag: "自然语言建流",
      },
      {
        title: "模板画廊",
        desc: "内容改写、线索捕获、每周报告、评论自动回复……从模板出发，绝不面对空白画布。",
        tag: "开箱即用",
      },
      {
        title: "统一收件箱",
        desc: "聚合各平台评论与私信，购买意图一出现就触发自动化，商机不再溜走。",
        tag: "评论 / DM 聚合",
      },
      {
        title: "社交日历",
        desc: "多平台内容排期一眼看全，拖拽调整，精灵按点替你发布。",
        tag: "排期视图",
      },
      {
        title: "用量仪表盘",
        desc: "任务额度、连接账号、运行成功率、错误率——每一分花费都明明白白。",
        tag: "透明计量",
      },
    ],
  },
  copilot: {
    badge: "咒语演示 · AI Copilot Builder",
    l1: "说一句人话，",
    l2pre: "精灵",
    l2hi: "画好整张地图",
    subtitle: "不需要懂 API，也不需要从空白画布开始。描述你想要的结果，Copilot 会生成工作流草稿、解释每一步，并先试运行给你看。",
    bullets: [
      "自然语言生成 workflow draft，随改随用",
      "每一步都有解释——精灵从不说黑话",
      "Dry-run 试运行：先彩排，再正式上岗",
      "敏感动作默认请求审批，绝不擅自行动",
    ],
    windowTitle: "Piggybot Copilot",
    windowStatus: "在线 · 随时待命",
    userMsg: "每周五把本周表现最好的帖子总结成报告，发给团队。🙏",
    botMsg: "好嘞！草图画好了，你看看这条路顺不顺：",
    draftTitle: "📋 工作流草稿 · 每周增长报告",
    steps: [
      { label: "定时触发", detail: "每周五 17:00 自动启动" },
      { label: "自动拉取数据", detail: "汇总各平台本周表现" },
      { label: "AI · 生成总结", detail: "亮点、踩坑与下周选题建议" },
      { label: "写入 Notion", detail: "归档成团队知识库" },
      { label: "发送到飞书群", detail: "@相关同事查收" },
    ],
    accept: "接受草稿",
    dryrun: "先试运行",
    costNote: "预计每次运行 ≈ 3 task",
  },
  workflows: {
    badge: "工作流剧场",
    pre: "四出拿手好戏，",
    hi: "每天都在上演",
    subtitle: "每一幕都来自真实的营销日常。从模板一键开演，也可以让 Copilot 按你的剧本改。",
    items: [
      {
        scene: "第一幕",
        title: "内容一变多排期",
        persona: "创作者",
        quote: "“粘一个想法，变出全平台的版本。”",
        steps: ["手动触发", "AI 识别主题", "AI 生成 4 平台版本", "人工审批", "多平台排期发布", "飞书通知"],
        cost: "1 AI + 4 发布 ≈ 5 task / 次",
      },
      {
        scene: "第二幕",
        title: "评论变线索",
        persona: "增长营销",
        quote: "“购买意图一出现，线索自动入库。”",
        steps: ["新评论触发", "AI 识别意图", "条件：购买 / 询价", "模板回复", "写入 HubSpot", "销售群提醒"],
        cost: "分类按批计费，回复 1 task / 条",
      },
      {
        scene: "第三幕",
        title: "每周增长报告",
        persona: "代理商经理",
        quote: "“每个客户，周一早上都收到自动周报。”",
        steps: ["周一 9:00 触发", "拉取多账号数据", "AI 总结得失", "写入 Docs / Notion", "发送客户", "审计留档"],
        cost: "整份报告 ≈ 3 task",
      },
      {
        scene: "第四幕",
        title: "广告守护助手",
        persona: "预算负责人",
        quote: "“超支之前，精灵先问你一声。”",
        steps: ["每日巡检", "拉取 Campaigns", "CPL 超阈值？", "AI 解释原因", "审批：暂停 / 降预算", "执行变更"],
        cost: "巡检 0 task，执行才算",
      },
    ],
  },
  modes: {
    badge: "精灵的三种修行模式",
    pre: "自主权由你授予，",
    hi: "一步一步来",
    subtitle: "不是传统的 if-this-then-that，而是 AI Agent 在边界内规划、调用工具、总结、请求审批。信任是慢慢建立的，精灵懂这个道理。",
    favorite: "村民最爱",
    note: "三种模式共享同一套审批与审计结界，随时切换，随时收回授权",
    items: [
      {
        level: "修行 · 壹",
        name: "Copilot 建议模式",
        slogan: "只出主意，不动手",
        desc: "精灵给建议、画草稿，所有执行都由你亲手点下确认键。",
        fit: "适合：刚搬进精灵村的新手",
        points: ["生成建议与草稿", "解释每一步逻辑", "手动确认后执行"],
      },
      {
        level: "修行 · 贰",
        name: "Assisted 协助模式",
        slogan: "低风险自动做，高风险先敲门",
        desc: "日常杂务自动完成；公开发布、回复客户、调整广告预算前，一定先请你批准。",
        fit: "适合：大多数团队（默认推荐）",
        points: ["低风险动作自动执行", "敏感动作默认送审批", "审批后才会计费执行"],
      },
      {
        level: "修行 · 叁",
        name: "Autopilot 自动模式",
        slogan: "结界之内，自由飞行",
        desc: "在你画好的 policy sandbox 里全自主执行，全程留痕，随时可回滚。",
        fit: "适合：流程成熟的增长团队",
        points: ["策略沙盒内自主执行", "每次决策全程留痕", "一键回滚任意动作"],
      },
    ],
  },
  governance: {
    badge: "安心结界 · Governance",
    pre: "精灵再能干，",
    hi: "也飞不出你的结界",
    subtitle: "治理不是企业版加购项，而是 AI 自动化信任的地基。每一次动作可审批、可追踪、可回滚、可计费。",
    bubbleQuote: "“在结界里，安心飞。”",
    items: [
      {
        title: "审批策略",
        desc: "按动作、金额、平台、品牌、角色灵活触发审批。公开发布、回复客户、改动预算——都得先敲你的门。",
      },
      {
        title: "RBAC + 托管连接",
        desc: "凭据归团队所有，成员不直接接触 token。人走了，自动化还在稳稳运行。",
      },
      {
        title: "不可篡改审计日志",
        desc: "每次 AI 决策、工具调用、输入输出与 task 费用全部留痕。老板问起来，一分钟拿出全账。",
      },
      {
        title: "密钥保险库",
        desc: "OAuth token 与 API key 加密保存，最小权限授权，数据保留周期按工作区可配。",
      },
    ],
  },
  integrations: {
    badge: "精灵集市 · Integrations",
    pre: "一座集市，",
    hi: "连接你的所有工具",
    subtitle: "一次授权，连通 15+ 社交平台，对接细节全部藏在幕后；你的自有 AI agent 也可以通过 MCP 调用这些能力。",
    socialTitle: "社交与广告平台",
    socialSub: "发布 / 定时 / 分析 / 评论 / 私信，一次连接全搞定",
    adsLabel: "广告能力：",
    saasTitle: "SaaS 连接器",
    saasSub: "少而精的高价值连接：CRM、表格、IM、文档、通用扩展",
    saas: [
      { name: "HubSpot", c: "#FADCCB" }, { name: "Salesforce", c: "#CFE7F5" }, { name: "Google Sheets", c: "#D6ECD9" },
      { name: "Airtable", c: "#FBE3C8" }, { name: "Slack", c: "#E8DEF0" }, { name: "飞书", c: "#D0E3F8" },
      { name: "Notion", c: "#ECEAE4" }, { name: "Google Docs", c: "#D5E6F8" }, { name: "Webhook / HTTP", c: "#F5EBD3" },
    ],
    devNote: "开发者通道：REST API · Webhook · MCP Server · SDK",
  },
  pricing: {
    badge: "价目灯笼 · Pricing",
    pre: "按",
    hi: "实际干活的量",
    post: "付费，童叟无欺",
    subtitle: "平台订阅 + 内含连接账号 + 内含 task 额度 + 超额用量。触发、过滤、审批通知统统不计费——精灵只为成功的动作收租。",
    bannerPre: "🎁 全部计划均含 ",
    bannerHi: "7 天免费试用 · 100 task",
    bannerPost: " 体验额度，不满意随时离开",
    recommended: "村长推荐",
    trialNote: "7 天免费试用 · 含 100 task",
    per: "/ 月",
    plans: [
      {
        name: "Creator",
        cn: "创作者树屋",
        price: "$19",
        target: "独立创作者 / 一人团队",
        accounts: "1 个连接账号",
        tasks: "3,000 task / 月",
        features: ["内容排期 + AI 模板", "统一收件箱", "社交日历", "邮件支持"],
        cta: "搬进树屋",
      },
      {
        name: "Growth",
        cn: "成长团队馆",
        price: "$49",
        target: "SMB 营销团队",
        accounts: "10 个连接账号",
        tasks: "10,000 task / 月",
        features: ["团队工作流 + 审批", "CRM / 表格 / IM 连接器", "品牌声音记忆", "用量仪表盘", "优先支持"],
        cta: "团队开馆",
      },
      {
        name: "Agency",
        cn: "代理商庄园",
        price: "$149",
        target: "多客户代运营",
        accounts: "30 个连接账号",
        tasks: "50,000 task / 月",
        features: ["多客户工作区", "客户周报自动化", "白标报告", "专属客户经理"],
        cta: "圈地建庄园",
      },
    ],
    overageTitle: "🧮 超额怎么算？",
    overage: [
      <>· 额外社交账号：<b className="text-ink">$1 – $6 / 账号 / 月</b>（按量级与平台成本）</>,
      <>· 额外任务：<b className="text-ink">$10 / 10,000 task</b> 起</>,
      <>· 高级 AI 任务：旗舰模型生成 ≈ <b className="text-ink">3 个标准 task</b></>,
    ],
    taskTitle: "✨ 什么算一个 task？",
    taskRules: [
      <>· 触发监听、过滤条件、审批通知：<b className="text-ink">0 task</b></>,
      <>· 成功的对外动作（发布 / 回复 / 写入）：<b className="text-ink">1 task</b></>,
      <>· AI 生成 / 分类：<b className="text-ink">1 – 3 task</b>，按模型成本计</>,
      <>· 失败的步骤：<b className="text-ink">不计费</b></>,
    ],
  },
  faq: {
    badge: "问答树洞",
    pre: "把疑问",
    hi: "丢进树洞",
    post: "，精灵来答",
    items: [
      {
        q: "我完全不会写代码，真的能用吗？",
        a: "当然。Piggybot 就是为 no-code 用户建的村子：模板画廊一键开演，Copilot 听懂人话帮你画工作流，可视化画布上全是业务语言——技术细节全部藏在幕后。",
      },
      {
        q: "什么是 task（任务额度）？会不会一不小心扣很多？",
        a: "一个 task = 一次成功的对外动作，比如发布一条帖子、回复一条评论、写入一行 CRM 记录。触发、过滤、审批通知都不计费，失败也不计费。启用工作流前会展示预估消耗，仪表盘随时可查。",
      },
      {
        q: "AI 精灵会不会背着我乱发东西？",
        a: "不会。默认 Assisted 模式下，公开发布、回复客户、调整广告预算都必须经过你审批。品牌声音记忆、禁用词、审批策略层层设防，而且每一次动作都有不可篡改的审计日志。",
      },
      {
        q: "支持哪些平台？",
        a: "覆盖 Instagram、TikTok、YouTube、X、LinkedIn、Facebook 等 15+ 社交平台，以及 Meta / Google / TikTok 等 6 大广告平台；SaaS 侧支持 HubSpot、Salesforce、Sheets、Slack、飞书、Notion 等连接器，一次授权即可连通。",
      },
      {
        q: "和 Zapier 有什么不同？",
        a: "Zapier 是横向连接 9,000+ 应用的通用平台；Piggybot 选择在社交、营销与客户互动场景做深——内容一变多、评论变线索、广告守护这类闭环开箱即用，而不是留给你一块空白画布。",
      },
      {
        q: "开发者可以用吗？",
        a: "可以。REST API、Webhook、MCP server 与 SDK 全都开放。你可以把社交 / 广告能力嵌进自己的 AI agent，省掉逐平台对接的成本。",
      },
    ],
  },
  footer: {
    l1: "今晚就开始，",
    l2pre: "让精灵替你",
    l2hi: "值夜班",
    tagline: "your workbuddy never sleeps",
    sub: "留下邮箱，第一批搬进精灵村。全部计划均可 7 天免费试用，含 100 task 体验额度。",
    signupFormTitle: "Piggybot 订阅表单",
    columns: [
      { title: "产品", links: ["Flow Builder", "AI Copilot", "模板画廊", "统一收件箱", "用量仪表盘"] },
      { title: "场景", links: ["内容一变多", "评论变线索", "每周增长报告", "广告守护"] },
      { title: "资源", links: ["开发者 API", "MCP Server", "帮助中心", "更新日志"] },
    ],
    copyright: "© 2026 精灵村村委会 · piggybot.me",
    madeWith: "由爱与一缕吉卜力之风打造",
  },
};

const en: SiteContent = {
  htmlLang: "en",
  docTitle: "Piggybot — Your Digital Twin for Marketing Ops",
  metaDescription: "Piggybot is your digital twin for marketing operations. Describe what you need in plain language and turn content, approvals, publishing, messages, leads and reports into automated workflows.",
  ogDescription: "Say the word and let AI sprites run your marketing operations.",
  nav: {
    links: [
      { label: "Features", href: "#features" },
      { label: "Copilot Demo", href: "#copilot" },
      { label: "Workflows", href: "#workflows" },
      { label: "Agent Modes", href: "#modes" },
      { label: "Governance", href: "#governance" },
      { label: "Integrations", href: "#integrations" },
      { label: "Pricing", href: "#pricing" },
    ],
    cta: "Start Free",
  },
  hero: {
    badge: "Your marketing-ops digital twin · AI sprites that get work done",
    l1: "Give your marketing ops",
    l2pre: "to a ",
    l2hi: "flying sprite crew",
    tagline: "your digital twin for marketing ops",
    subtitle:
      "Piggybot is your digital twin for marketing operations. No code — just say the word, and your sprites turn “content → approval → multi-platform publishing → comments & DMs → leads into CRM → recap reports” into a little river that flows by itself.",
    ctaPrimary: "Summon Your Sprites",
    ctaSecondary: "See Workflows in Action",
    chips: ["15+ social platforms, one connection", "6 major ad networks", "4 ready-made playbooks", "Every action approvable"],
    scroll: "Scroll down to Sprite Village",
  },
  marquee: [
    "One post, every platform",
    "Comments to leads",
    "Weekly growth reports",
    "Ad guardian",
    "Unified inbox",
    "Social calendar",
    "Natural-language builder",
    "Approvals & rollback",
    "Task-based billing",
    "Brand voice memory",
  ],
  features: {
    badge: "The sprites' six superpowers",
    pre: "You create,",
    hi: "sprites do the chores",
    subtitle: "From a single post to a full growth loop, Piggybot hides all the plumbing — you only see business scenarios and results.",
    items: [
      {
        title: "Visual Flow Builder",
        desc: "Snap together triggers, conditions, actions, AI and approval steps like building blocks. You see scenarios and outcomes, not API endpoints.",
        tag: "No-code canvas",
      },
      {
        title: "AI Copilot Builder",
        desc: "Say it in plain words — your sprite drafts the workflow and explains every step it plans to take.",
        tag: "Natural-language building",
      },
      {
        title: "Template Gallery",
        desc: "Repurposing, lead capture, weekly reports, auto-replies… start from a template, never a blank canvas.",
        tag: "Ready to use",
      },
      {
        title: "Unified Inbox",
        desc: "Comments and DMs from every platform in one place — buying intent triggers automation the moment it appears.",
        tag: "Comments / DMs",
      },
      {
        title: "Social Calendar",
        desc: "Every scheduled post across platforms at a glance. Drag to adjust, sprites publish on time.",
        tag: "Scheduling view",
      },
      {
        title: "Usage Dashboard",
        desc: "Task credits, connected accounts, run success and error rates — every penny accounted for.",
        tag: "Transparent metering",
      },
    ],
  },
  copilot: {
    badge: "Spell Demo · AI Copilot Builder",
    l1: "Say it in plain words,",
    l2pre: "sprites ",
    l2hi: "draw the whole map",
    subtitle: "No APIs to learn, no blank canvas. Describe the outcome you want — Copilot drafts the workflow, explains each step, and does a dry run first.",
    bullets: [
      "Turn plain language into a workflow draft",
      "Every step explained — no jargon, ever",
      "Dry-run mode: rehearse before going live",
      "Sensitive actions always ask for approval",
    ],
    windowTitle: "Piggybot Copilot",
    windowStatus: "Online · at your service",
    userMsg: "Every Friday, summarize this week's best-performing posts into a report and send it to the team. 🙏",
    botMsg: "On it! Here's the draft map — how does this route look?",
    draftTitle: "📋 Workflow draft · Weekly growth report",
    steps: [
      { label: "Scheduled trigger", detail: "Every Friday at 5:00 PM" },
      { label: "Auto-fetch data", detail: "This week's stats from all platforms" },
      { label: "AI summary", detail: "Wins, misses & next-week topics" },
      { label: "Write to Notion", detail: "Filed into the team knowledge base" },
      { label: "Send to Slack", detail: "@teammates to review" },
    ],
    accept: "Accept draft",
    dryrun: "Dry run first",
    costNote: "≈ 3 tasks per run",
  },
  workflows: {
    badge: "Workflow Theater",
    pre: "Four signature acts,",
    hi: "performed daily",
    subtitle: "Each act comes from real marketing routines. Start from a template in one click, or let Copilot adapt it to your script.",
    items: [
      {
        scene: "Act I",
        title: "Repurpose & Schedule Everywhere",
        persona: "Creator",
        quote: "“Paste one idea, get native versions for every platform.”",
        steps: ["Manual trigger", "AI detects topic", "AI writes 4 versions", "Human approval", "Schedule to all platforms", "Slack notification"],
        cost: "1 AI + 4 publishes ≈ 5 tasks / run",
      },
      {
        scene: "Act II",
        title: "Comments to Leads",
        persona: "Growth marketer",
        quote: "“The moment buying intent appears, the lead lands in your CRM.”",
        steps: ["New comment", "AI intent detection", "Condition: buying / pricing", "Template reply", "Create lead in HubSpot", "Sales-channel alert"],
        cost: "Classification billed per batch, 1 task per reply",
      },
      {
        scene: "Act III",
        title: "Weekly Growth Report",
        persona: "Agency manager",
        quote: "“Every client gets an automatic report on Monday morning.”",
        steps: ["Monday 9:00 AM", "Pull multi-account stats", "AI sums up wins & misses", "Write to Docs / Notion", "Send to client", "Audit trail"],
        cost: "≈ 3 tasks per report",
      },
      {
        scene: "Act IV",
        title: "Ad Guardian",
        persona: "Budget owner",
        quote: "“Before you overspend, your sprite asks first.”",
        steps: ["Daily patrol", "Fetch campaigns", "CPL over threshold?", "AI explains why", "Approve: pause / cut budget", "Execute change"],
        cost: "Patrols cost 0 tasks — only execution counts",
      },
    ],
  },
  modes: {
    badge: "Three training modes",
    pre: "You grant autonomy,",
    hi: "step by step",
    subtitle: "Not old-school if-this-then-that — AI agents that plan, call tools, summarize and ask for approval within boundaries. Trust is built gradually, and the sprites know it.",
    favorite: "Village favorite",
    note: "All three modes share the same approval & audit barrier — switch or revoke anytime",
    items: [
      {
        level: "Level I",
        name: "Copilot Mode",
        slogan: "Advises only, never acts",
        desc: "Sprites suggest and draft; you press confirm for every execution.",
        fit: "For newcomers to Sprite Village",
        points: ["Suggestions & drafts", "Every step explained", "Runs on your confirmation"],
      },
      {
        level: "Level II",
        name: "Assisted Mode",
        slogan: "Low-risk auto, high-risk asks first",
        desc: "Chores run automatically; publishing, customer replies and ad budgets always knock for approval first.",
        fit: "For most teams (recommended default)",
        points: ["Low-risk runs automatically", "Sensitive actions need approval", "Billed only after approval"],
      },
      {
        level: "Level III",
        name: "Autopilot Mode",
        slogan: "Free flight inside the barrier",
        desc: "Fully autonomous within your policy sandbox — every action logged, every move reversible.",
        fit: "For mature growth teams",
        points: ["Autonomous within sandbox", "Every decision logged", "One-click rollback"],
      },
    ],
  },
  governance: {
    badge: "Safety Barrier · Governance",
    pre: "However capable,",
    hi: "sprites never leave your barrier",
    subtitle: "Governance isn't an enterprise add-on — it's the foundation of trust in AI automation. Every action is approvable, traceable, reversible and billable.",
    bubbleQuote: "“Fly free — inside the barrier.”",
    items: [
      {
        title: "Approval Policies",
        desc: "Trigger approvals by action, amount, platform, brand or role. Publishing, customer replies, budget changes — all knock on your door first.",
      },
      {
        title: "RBAC + Managed Connections",
        desc: "Credentials belong to the team; members never touch tokens. People leave — automations keep running.",
      },
      {
        title: "Immutable Audit Log",
        desc: "Every AI decision, tool call, input/output and task cost is on record. Review the complete audit trail in under a minute.",
      },
      {
        title: "Secret Vault",
        desc: "OAuth tokens and API keys encrypted at rest, least-privilege scopes, per-workspace data retention.",
      },
    ],
  },
  integrations: {
    badge: "Sprite Market · Integrations",
    pre: "One market,",
    hi: "connects all your tools",
    subtitle: "Authorize once to connect 15+ social platforms — all plumbing stays behind the scenes; your own AI agents can call these powers via MCP too.",
    socialTitle: "Social & Ad Platforms",
    socialSub: "Publish / schedule / analytics / comments / DMs — one connection does it all",
    adsLabel: "Ads:",
    saasTitle: "SaaS Connectors",
    saasSub: "Few but mighty: CRM, sheets, IM, docs and universal hooks",
    saas: [
      { name: "HubSpot", c: "#FADCCB" }, { name: "Salesforce", c: "#CFE7F5" }, { name: "Google Sheets", c: "#D6ECD9" },
      { name: "Airtable", c: "#FBE3C8" }, { name: "Slack", c: "#E8DEF0" }, { name: "Lark", c: "#D0E3F8" },
      { name: "Notion", c: "#ECEAE4" }, { name: "Google Docs", c: "#D5E6F8" }, { name: "Webhook / HTTP", c: "#F5EBD3" },
    ],
    devNote: "Developer lane: REST API · Webhook · MCP Server · SDK",
  },
  pricing: {
    badge: "Price Lanterns · Pricing",
    pre: "Pay for ",
    hi: "real work done",
    post: ", fair and square",
    subtitle: "Platform subscription + included accounts + included tasks + overage. Triggers, filters and approval pings are always free — sprites only charge for successful actions.",
    bannerPre: "🎁 Every plan includes a ",
    bannerHi: "7-day free trial · 100 tasks",
    bannerPost: " — leave anytime, no hard feelings",
    recommended: "Village pick",
    trialNote: "7-day free trial · 100 tasks included",
    per: "/ mo",
    plans: [
      {
        name: "Creator",
        cn: "Creator Treehouse",
        price: "$19",
        target: "Solo creators & one-person teams",
        accounts: "1 connected account",
        tasks: "3,000 tasks / mo",
        features: ["Scheduling + AI templates", "Unified inbox", "Social calendar", "Email support"],
        cta: "Move into the treehouse",
      },
      {
        name: "Growth",
        cn: "Growth Teamhouse",
        price: "$49",
        target: "SMB marketing teams",
        accounts: "10 connected accounts",
        tasks: "10,000 tasks / mo",
        features: ["Team workflows + approvals", "CRM / sheets / IM connectors", "Brand voice memory", "Usage dashboard", "Priority support"],
        cta: "Open the teamhouse",
      },
      {
        name: "Agency",
        cn: "Agency Manor",
        price: "$149",
        target: "Multi-client operators",
        accounts: "30 connected accounts",
        tasks: "50,000 tasks / mo",
        features: ["Multi-client workspaces", "Automated client reports", "White-label reports", "Dedicated account manager"],
        cta: "Claim your manor",
      },
    ],
    overageTitle: "🧮 How does overage work?",
    overage: [
      <>· Extra social account: <b className="text-ink">$1 – $6 / account / mo</b> (by volume & platform)</>,
      <>· Extra tasks: from <b className="text-ink">$10 / 10,000 tasks</b></>,
      <>· Premium AI tasks: frontier-model generation ≈ <b className="text-ink">3 standard tasks</b></>,
    ],
    taskTitle: "✨ What counts as a task?",
    taskRules: [
      <>· Triggers, filters, approval pings: <b className="text-ink">0 tasks</b></>,
      <>· Successful external action (publish / reply / write): <b className="text-ink">1 task</b></>,
      <>· AI generation / classification: <b className="text-ink">1 – 3 tasks</b>, by model cost</>,
      <>· Failed steps: <b className="text-ink">free</b></>,
    ],
  },
  faq: {
    badge: "The Q&A Tree Hollow",
    pre: "Drop questions in the ",
    hi: "tree hollow",
    post: ", sprites answer",
    items: [
      {
        q: "I can't code at all. Can I really use this?",
        a: "Absolutely. Piggybot is a village built for no-code folks: one-click templates, a Copilot that understands plain language, and a canvas full of business words — all technical details stay behind the scenes.",
      },
      {
        q: "What is a task? Could I burn through them by accident?",
        a: "One task = one successful external action, like publishing a post, replying to a comment, or writing a CRM record. Triggers, filters and approval pings are free, and failures are free too. You'll see an estimate before enabling any workflow, and the dashboard tracks everything.",
      },
      {
        q: "Will the AI sprites post things behind my back?",
        a: "Never. In the default Assisted mode, publishing, customer replies and ad-budget changes all require your approval. Brand voice memory, banned words and approval policies form layers of defense — and every action lands in an immutable audit log.",
      },
      {
        q: "Which platforms are supported?",
        a: "15+ social platforms including Instagram, TikTok, YouTube, X, LinkedIn and Facebook, plus 6 ad networks (Meta / Google / TikTok and more); SaaS connectors include HubSpot, Salesforce, Sheets, Slack, Notion and more — one authorization connects them all.",
      },
      {
        q: "How is this different from Zapier?",
        a: "Zapier is a horizontal platform connecting 9,000+ apps; Piggybot goes deep in social, marketing and customer engagement — ready-made loops like repurpose-everywhere, comments-to-leads and ad guarding, instead of a blank canvas.",
      },
      {
        q: "Can developers use it?",
        a: "Yes. REST API, Webhooks, MCP server and SDKs are all open — embed social and ads capabilities into your own AI agents without platform-by-platform integration.",
      },
    ],
  },
  footer: {
    l1: "Start tonight,",
    l2pre: "let sprites take the ",
    l2hi: "night shift",
    tagline: "your workbuddy never sleeps",
    sub: "Leave your email and be among the first to move into Sprite Village. Every plan starts with a 7-day free trial and 100 tasks.",
    signupFormTitle: "Piggybot sign-up form",
    columns: [
      { title: "Product", links: ["Flow Builder", "AI Copilot", "Template Gallery", "Unified Inbox", "Usage Dashboard"] },
      { title: "Playbooks", links: ["Repurpose everywhere", "Comments to leads", "Weekly growth report", "Ad guardian"] },
      { title: "Resources", links: ["Developer API", "MCP Server", "Help center", "Changelog"] },
    ],
    copyright: "© 2026 Sprite Village Council · piggybot.me",
    madeWith: "built with ♥ and a little Ghibli wind",
  },
};

const es: SiteContent = {
  htmlLang: "es",
  docTitle: "Piggybot — Tu gemelo digital para las operaciones de marketing",
  metaDescription: "Piggybot es tu gemelo digital para las operaciones de marketing. Describe lo que necesitas en lenguaje natural y convierte contenido, aprobaciones, publicaciones, mensajes, leads e informes en flujos automatizados.",
  ogDescription: "Dilo con tus propias palabras y deja que los duendes de IA gestionen tu marketing.",
  nav: {
    links: [
      { label: "Funciones", href: "#features" },
      { label: "Demo Copilot", href: "#copilot" },
      { label: "Flujos", href: "#workflows" },
      { label: "Modos", href: "#modes" },
      { label: "Gobernanza", href: "#governance" },
      { label: "Integraciones", href: "#integrations" },
      { label: "Precios", href: "#pricing" },
    ],
    cta: "Empezar gratis",
  },
  hero: {
    badge: "Tu gemelo digital de marketing · duendes de IA que sí trabajan",
    l1: "Deja tu marketing",
    l2pre: "en manos de ",
    l2hi: "duendes voladores",
    tagline: "tu gemelo digital para el marketing",
    subtitle:
      "Piggybot es tu gemelo digital para las operaciones de marketing. Sin código: solo dilo en palabras simples y tus duendes convertirán «contenido → aprobación → publicación multiplataforma → comentarios y mensajes → leads al CRM → informes» en un riachuelo que fluye solo.",
    ctaPrimary: "Invoca a tus duendes",
    ctaSecondary: "Ver el teatro de flujos",
    chips: ["15+ redes sociales, una conexión", "6 plataformas de anuncios", "4 guías listas para usar", "Cada acción aprobable"],
    scroll: "Baja a la Aldea de los Duendes",
  },
  marquee: [
    "Un post, todas las plataformas",
    "Comentarios en leads",
    "Informe semanal de crecimiento",
    "Guardián de anuncios",
    "Bandeja unificada",
    "Calendario social",
    "Constructor en lenguaje natural",
    "Aprobaciones y reversión",
    "Facturación por tareas",
    "Memoria de voz de marca",
  ],
  features: {
    badge: "Los seis superpoderes de los duendes",
    pre: "Tú creas,",
    hi: "los duendes trabajan",
    subtitle: "De una sola publicación a un ciclo de crecimiento completo: Piggybot oculta toda la fontanería técnica — tú solo ves escenarios y resultados.",
    items: [
      {
        title: "Constructor visual de flujos",
        desc: "Une disparadores, condiciones, acciones, pasos de IA y aprobaciones como bloques. Ves escenarios y resultados, no endpoints de API.",
        tag: "Lienzo no-code",
      },
      {
        title: "Copilot constructor",
        desc: "Dilo con palabras simples: tu duende dibuja el flujo y explica cada paso que piensa dar.",
        tag: "Lenguaje natural",
      },
      {
        title: "Galería de plantillas",
        desc: "Reutilización de contenido, captura de leads, informes semanales, respuestas automáticas… empieza desde una plantilla, nunca desde cero.",
        tag: "Listo para usar",
      },
      {
        title: "Bandeja unificada",
        desc: "Comentarios y mensajes de todas las plataformas en un solo lugar; la intención de compra dispara la automatización al instante.",
        tag: "Comentarios / DMs",
      },
      {
        title: "Calendario social",
        desc: "Todas las publicaciones programadas de un vistazo; arrastra para ajustar y los duendes publican a tiempo.",
        tag: "Vista de agenda",
      },
      {
        title: "Panel de uso",
        desc: "Créditos de tareas, cuentas conectadas, tasas de éxito y error — cada centavo contabilizado.",
        tag: "Medición transparente",
      },
    ],
  },
  copilot: {
    badge: "Demo de hechizo · Constructor con Copilot de IA",
    l1: "Dilo en palabras simples,",
    l2pre: "el duende ",
    l2hi: "dibuja el mapa",
    subtitle: "Sin APIs que aprender, sin lienzo en blanco. Describe el resultado y Copilot prepara el borrador del flujo, explica cada paso y hace un ensayo primero.",
    bullets: [
      "De lenguaje natural a borrador de flujo",
      "Cada paso explicado, sin jerga",
      "Modo de ensayo: prueba antes de activar",
      "Las acciones sensibles siempre piden aprobación",
    ],
    windowTitle: "Piggybot Copilot",
    windowStatus: "En línea · a tu servicio",
    userMsg: "Cada viernes, resume las publicaciones con mejor rendimiento de la semana en un informe y envíalo al equipo. 🙏",
    botMsg: "¡Claro! Ya dibujé el borrador, ¿qué te parece esta ruta?",
    draftTitle: "📋 Borrador de flujo · Informe semanal",
    steps: [
      { label: "Disparador programado", detail: "Todos los viernes a las 17:00" },
      { label: "Obtener datos", detail: "Resumen semanal de todas las plataformas" },
      { label: "Resumen con IA", detail: "Logros, tropiezos y temas sugeridos" },
      { label: "Escribir en Notion", detail: "Archivado en la base de conocimiento" },
      { label: "Enviar a Slack", detail: "Avisar al equipo para revisarlo" },
    ],
    accept: "Aceptar borrador",
    dryrun: "Ensayar primero",
    costNote: "≈ 3 tareas por ejecución",
  },
  workflows: {
    badge: "Teatro de flujos",
    pre: "Cuatro actos estrella,",
    hi: "en escena cada día",
    subtitle: "Cada acto nace del día a día del marketing. Empieza desde una plantilla o deja que Copilot la adapte a tu guion.",
    items: [
      {
        scene: "Acto primero",
        title: "Un post, todas las plataformas",
        persona: "Creador",
        quote: "«Pega una idea y obtén versiones nativas para cada plataforma.»",
        steps: ["Disparo manual", "IA detecta el tema", "IA crea 4 versiones", "Aprobación humana", "Programar en todas las plataformas", "Aviso en Slack"],
        cost: "1 IA + 4 publicaciones ≈ 5 tareas / vez",
      },
      {
        scene: "Acto segundo",
        title: "Comentarios en leads",
        persona: "Especialista en marketing de crecimiento",
        quote: "«Cuando aparece intención de compra, el lead entra solo al CRM.»",
        steps: ["Nuevo comentario", "IA detecta intención", "Condición: compra / precio", "Respuesta con plantilla", "Crear lead en HubSpot", "Alerta al canal de ventas"],
        cost: "Clasificación por lote, 1 tarea por respuesta",
      },
      {
        scene: "Acto tercero",
        title: "Informe semanal de crecimiento",
        persona: "Gerente de agencia",
        quote: "«Cada cliente recibe su informe automático el lunes por la mañana.»",
        steps: ["Lunes 9:00", "Extraer estadísticas", "IA resume aciertos y errores", "Escribir en Docs / Notion", "Enviar al cliente", "Registro de auditoría"],
        cost: "≈ 3 tareas por informe",
      },
      {
        scene: "Acto cuarto",
        title: "Guardián de anuncios",
        persona: "Dueño del presupuesto",
        quote: "«Antes de gastar de más, tu duende te pregunta.»",
        steps: ["Patrulla diaria", "Obtener campañas", "¿CPL sobre el límite?", "IA explica la causa", "Aprobar: pausar / bajar presupuesto", "Ejecutar cambio"],
        cost: "Patrullar cuesta 0 tareas — solo ejecutar cuenta",
      },
    ],
  },
  modes: {
    badge: "Tres modos de entrenamiento",
    pre: "La autonomía la das tú,",
    hi: "paso a paso",
    subtitle: "No es el clásico if-this-then-that: son agentes de IA que planifican, usan herramientas, resumen y piden aprobación dentro de los límites. La confianza se construye poco a poco, y los duendes lo saben.",
    favorite: "Favorito de la aldea",
    note: "Los tres modos comparten la misma barrera de aprobaciones y auditoría — cambia o revoca cuando quieras",
    items: [
      {
        level: "Nivel I",
        name: "Modo Copilot",
        slogan: "Solo aconseja, nunca actúa",
        desc: "Los duendes sugieren y redactan; tú confirmas cada ejecución.",
        fit: "Para recién llegados a la aldea",
        points: ["Sugerencias y borradores", "Cada paso explicado", "Ejecuta con tu confirmación"],
      },
      {
        level: "Nivel II",
        name: "Modo Asistido",
        slogan: "Lo de bajo riesgo, automático; lo de alto riesgo, primero pregunta",
        desc: "Las tareas rutinarias corren solas; publicar, responder a clientes y mover presupuestos siempre llaman primero a tu puerta.",
        fit: "Para la mayoría de los equipos (recomendado)",
        points: ["Bajo riesgo automático", "Acciones sensibles con aprobación", "Solo se cobra tras aprobar"],
      },
      {
        level: "Nivel III",
        name: "Modo Autopilot",
        slogan: "Vuelo libre dentro de la barrera",
        desc: "Totalmente autónomo dentro de tu caja de políticas — cada acción registrada, cada movimiento reversible.",
        fit: "Para equipos de crecimiento maduros",
        points: ["Autónomo dentro del sandbox", "Cada decisión registrada", "Reversión con un clic"],
      },
    ],
  },
  governance: {
    badge: "Barrera de confianza · Gobernanza",
    pre: "Por muy capaces que sean,",
    hi: "no salen de tu barrera",
    subtitle: "La gobernanza no es un extra empresarial: es la base de la confianza en la automatización con IA. Cada acción es aprobable, rastreable, reversible y facturable.",
    bubbleQuote: "«Vuela tranquilo, dentro de la barrera.»",
    items: [
      {
        title: "Políticas de aprobación",
        desc: "Activa aprobaciones por acción, monto, plataforma, marca o rol. Publicar, responder a clientes, cambiar presupuestos: todo llama primero a tu puerta.",
      },
      {
        title: "RBAC + conexiones gestionadas",
        desc: "Las credenciales son del equipo; los miembros nunca tocan los tokens. Las personas se van, las automatizaciones siguen.",
      },
      {
        title: "Registro de auditoría inmutable",
        desc: "Cada decisión de IA, llamada de herramienta, entrada/salida y costo de tarea queda registrado. Cuentas completas en menos de un minuto.",
      },
      {
        title: "Bóveda de secretos",
        desc: "Tokens OAuth y claves API cifrados, permisos mínimos y retención de datos configurable por espacio de trabajo.",
      },
    ],
  },
  integrations: {
    badge: "Mercado de duendes · Integraciones",
    pre: "Un mercado,",
    hi: "conecta todas tus herramientas",
    subtitle: "Autoriza una vez y conecta más de 15 plataformas sociales — la fontanería queda entre bastidores; tus propios agentes de IA también pueden invocar estos poderes vía MCP.",
    socialTitle: "Redes sociales y anuncios",
    socialSub: "Publicar / programar / analizar / comentarios / mensajes — una conexión lo hace todo",
    adsLabel: "Anuncios:",
    saasTitle: "Conectores SaaS",
    saasSub: "Pocos pero potentes: CRM, hojas de cálculo, mensajería, documentos e integraciones universales",
    saas: [
      { name: "HubSpot", c: "#FADCCB" }, { name: "Salesforce", c: "#CFE7F5" }, { name: "Google Sheets", c: "#D6ECD9" },
      { name: "Airtable", c: "#FBE3C8" }, { name: "Slack", c: "#E8DEF0" }, { name: "Lark", c: "#D0E3F8" },
      { name: "Notion", c: "#ECEAE4" }, { name: "Google Docs", c: "#D5E6F8" }, { name: "Webhook / HTTP", c: "#F5EBD3" },
    ],
    devNote: "Carril de desarrolladores: REST API · Webhook · MCP Server · SDK",
  },
  pricing: {
    badge: "Farolillos de precios · Precios",
    pre: "Paga por el trabajo ",
    hi: "realmente hecho",
    post: ", sin trucos",
    subtitle: "Suscripción + cuentas conectadas incluidas + tareas incluidas + excedente. Disparadores, filtros y avisos de aprobación siempre son gratis — los duendes solo cobran por acciones exitosas.",
    bannerPre: "🎁 Todos los planes incluyen ",
    bannerHi: "7 días gratis · 100 tareas",
    bannerPost: " — vete cuando quieras",
    recommended: "Elegido por la aldea",
    trialNote: "7 días gratis · 100 tareas incluidas",
    per: "/ mes",
    plans: [
      {
        name: "Creator",
        cn: "Cabaña del creador",
        price: "$19",
        target: "Creadores independientes y equipos de uno",
        accounts: "1 cuenta conectada",
        tasks: "3.000 tareas / mes",
        features: ["Programación + plantillas IA", "Bandeja unificada", "Calendario social", "Soporte por email"],
        cta: "Mudarse a la cabaña",
      },
      {
        name: "Growth",
        cn: "Cuartel del equipo",
        price: "$49",
        target: "Equipos de marketing pyme",
        accounts: "10 cuentas conectadas",
        tasks: "10.000 tareas / mes",
        features: ["Flujos de equipo + aprobaciones", "Conectores CRM / hojas / chat", "Memoria de voz de marca", "Panel de uso", "Soporte prioritario"],
        cta: "Abrir el cuartel",
      },
      {
        name: "Agency",
        cn: "Mansión de agencias",
        price: "$149",
        target: "Operadores multicliente",
        accounts: "30 cuentas conectadas",
        tasks: "50.000 tareas / mes",
        features: ["Espacios multicliente", "Informes automáticos para clientes", "Informes de marca blanca", "Gerente de cuenta dedicado"],
        cta: "Reclamar la mansión",
      },
    ],
    overageTitle: "🧮 ¿Cómo se cobra el excedente?",
    overage: [
      <>· Cuenta social extra: <b className="text-ink">$1 – $6 / cuenta / mes</b> (según volumen y plataforma)</>,
      <>· Tareas extra: desde <b className="text-ink">$10 / 10.000 tareas</b></>,
      <>· Tareas de IA prémium: generación con un modelo de frontera ≈ <b className="text-ink">3 tareas estándar</b></>,
    ],
    taskTitle: "✨ ¿Qué cuenta como una tarea?",
    taskRules: [
      <>· Disparadores, filtros y avisos: <b className="text-ink">0 tareas</b></>,
      <>· Acción externa exitosa (publicar / responder / escribir): <b className="text-ink">1 tarea</b></>,
      <>· Generación o clasificación IA: <b className="text-ink">1 – 3 tareas</b>, según el modelo</>,
      <>· Pasos fallidos: <b className="text-ink">gratis</b></>,
    ],
  },
  faq: {
    badge: "El hueco de las preguntas",
    pre: "Deja tus dudas en el ",
    hi: "hueco del árbol",
    post: ", los duendes responden",
    items: [
      {
        q: "No sé programar, ¿de verdad puedo usarlo?",
        a: "Por supuesto. Piggybot es una aldea construida para gente no-code: plantillas de un clic, un Copilot que entiende lenguaje natural y un lienzo lleno de palabras de negocio — los detalles técnicos quedan entre bastidores.",
      },
      {
        q: "¿Qué es una tarea? ¿Podría gastarlas sin darme cuenta?",
        a: "Una tarea = una acción externa exitosa, como publicar un post, responder un comentario o escribir un registro en el CRM. Disparadores, filtros y avisos son gratis, y los fallos también. Verás una estimación antes de activar cualquier flujo y el panel lo registra todo.",
      },
      {
        q: "¿Los duendes de IA publicarán cosas a mis espaldas?",
        a: "Jamás. En el modo Asistido (por defecto), publicar, responder a clientes y cambiar presupuestos requieren tu aprobación. Memoria de voz de marca, palabras prohibidas y políticas de aprobación forman capas de defensa — y cada acción queda en un registro inmutable.",
      },
      {
        q: "¿Qué plataformas son compatibles?",
        a: "Más de 15 plataformas sociales como Instagram, TikTok, YouTube, X, LinkedIn y Facebook, además de 6 redes de anuncios (Meta / Google / TikTok y más); conectores SaaS como HubSpot, Salesforce, Sheets, Slack, Notion y más — una sola autorización los conecta todos.",
      },
      {
        q: "¿En qué se diferencia de Zapier?",
        a: "Zapier es una plataforma horizontal con más de 9.000 aplicaciones; Piggybot profundiza en social, marketing y atención al cliente — bucles listos como «un post en todas partes», «comentarios en leads» y «guardián de anuncios», en lugar de un lienzo en blanco.",
      },
      {
        q: "¿Pueden usarlo los desarrolladores?",
        a: "Sí. REST API, Webhooks, servidor MCP y SDK están abiertos: integra las capacidades sociales y de anuncios en tus propios agentes de IA sin conectar plataforma por plataforma.",
      },
    ],
  },
  footer: {
    l1: "Empieza esta noche,",
    l2pre: "deja el turno de noche ",
    l2hi: "a los duendes",
    tagline: "your workbuddy never sleeps",
    sub: "Deja tu email y sé de los primeros en mudarte a la aldea. Todos los planes empiezan con 7 días gratis y 100 tareas.",
    signupFormTitle: "Formulario de registro de Piggybot",
    columns: [
      { title: "Producto", links: ["Constructor de flujos", "Copilot de IA", "Galería de plantillas", "Bandeja unificada", "Panel de uso"] },
      { title: "Guías", links: ["Un post en todas partes", "Comentarios en leads", "Informe semanal", "Guardián de anuncios"] },
      { title: "Recursos", links: ["API para desarrolladores", "Servidor MCP", "Centro de ayuda", "Novedades"] },
    ],
    copyright: "© 2026 Consejo de la Aldea · piggybot.me",
    madeWith: "creado con ♥ y un poco de viento Ghibli",
  },
};

export const CONTENT: Record<Lang, SiteContent> = { zh, en, es };
