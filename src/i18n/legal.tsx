import type { Lang } from "./content";

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  list?: string[];
}

export interface LegalDoc {
  docTitle: string;
  heading: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
}

/* ------------------------------------------------------------------ */
/* English (primary, drafted for the US market)                        */
/* ------------------------------------------------------------------ */

const privacyEn: LegalDoc = {
  docTitle: "Privacy Policy — Piggybot",
  heading: "Privacy Policy",
  updated: "Last updated: August 13, 2026",
  intro: [
    "Piggybot (\"Piggybot\", \"we\", \"us\" or \"our\") operates the website piggybot.me and the Piggybot marketing-automation platform (together, the \"Service\"). Piggybot is your digital twin for marketing operations: it helps you plan content, draft copy, run compliance checks, publish to social and advertising platforms, route messages and leads, and generate reports — under your approval policies.",
    "This Privacy Policy explains what personal information we collect, how we use and share it, and the choices and rights you have, including rights under United States federal and state privacy laws such as the California Consumer Privacy Act as amended by the CPRA (\"CCPA\").",
  ],
  sections: [
    {
      heading: "1. Information we collect",
      paragraphs: ["We collect information in three ways: information you give us, information collected automatically, and information from third-party platforms you connect."],
      list: [
        "Account and contact information — name, email address, password or single-sign-on identifier, company and role, when you create an account or contact support.",
        "Newsletter subscriptions — the email address you submit through our sign-up form, which is collected and stored via Google Forms and a linked Google Sheet operated by Google LLC.",
        "Connected platform data — when you authorize social media, advertising or SaaS accounts (for example Instagram, TikTok, YouTube, LinkedIn, X, Discord, Reddit, Substack, Telegram, Rednote, Meta/Google/TikTok ads, HubSpot, Salesforce, Google Sheets, Slack or Notion), we receive OAuth tokens and the account data needed to perform the actions you configure, such as profiles, posts, comments, messages, ad metrics and CRM records.",
        "Content you create — brand voice profiles, forbidden-word lists, drafts, templates, workflows, approval policies and approval decisions.",
        "Billing information — plan selection, usage meters (tasks and AI credits) and transaction history. Payment card details are processed by our payment processor and are never stored on our servers.",
        "Usage and device data — log data, IP address, browser type, pages viewed, feature interactions, approximate location derived from IP, and cookie identifiers.",
        "Support and feedback — messages, attachments and feedback category when you contact us or submit product feedback.",
        "Referral data — referral links, credited sign-ups and reward balances when you participate in our referral program.",
      ],
    },
    {
      heading: "2. How we use information",
      list: [
        "Provide, operate and maintain the Service, including executing workflows you configure and enforcing your approval policies.",
        "Generate AI-assisted drafts, plans, classifications and compliance checks using large-language-model providers acting as our processors.",
        "Process transactions, meter usage (tasks and AI credits), apply cost guardrails and send billing notices.",
        "Send service communications (approvals awaiting your review, security alerts, trial and subscription notices) and, where you opt in, product updates and newsletters.",
        "Secure the Service: fraud and abuse prevention, rate limiting, idempotency protection against duplicate publishing, audit logging and debugging.",
        "Improve and develop the Service, including aggregated and de-identified analytics.",
        "Comply with law, enforce our Terms of Service and protect our rights, users and the public.",
      ],
    },
    {
      heading: "3. How AI processing works",
      paragraphs: [
        "When a workflow includes an AI step, the relevant content (for example your brief, brand voice profile or a draft post) is sent to a large-language-model provider under a data-processing agreement solely to produce the output you requested. We operate multiple suppliers with automatic failover; routing is chosen based on availability and cost controls, not on selling your data. We do not use your content to train foundation models where the provider offers an opt-out, and we select providers whose API terms do not retain API inputs for model training by default.",
        "AI outputs are drafts. Deterministic checks (forbidden words, length limits) and AI semantic compliance review are applied before anything can be published, and — unless you explicitly enable auto-approve — no content is published, no customer is replied to, and no budget is changed without your approval.",
      ],
    },
    {
      heading: "4. How we share information",
      paragraphs: ["We do not sell your personal information, and we do not share it for cross-context behavioral advertising. We share information only with:"],
      list: [
        "Service providers / processors — cloud hosting, database, LLM inference, payment processing, email delivery, error monitoring and Google (which hosts our newsletter form and sheet). Each is bound by contract to use information only to provide services to us.",
        "Platforms you connect — when you direct the Service to publish, reply or sync, the content is transmitted to the destination platform under your own authorization and that platform's terms and privacy policy.",
        "Professional advisors and authorities — lawyers, auditors, regulators or law enforcement where required by law, subpoena or to protect rights and safety.",
        "Business transfers — in a merger, acquisition, financing or sale of assets, subject to this Policy.",
        "With your direction or consent — for example when you share a workflow template with your team.",
      ],
    },
    {
      heading: "5. Cookies and similar technologies",
      paragraphs: [
        "We use strictly necessary cookies (session, security, language preference) and, with your consent where required, analytics cookies to understand feature usage. You can control cookies through your browser settings. We honor the Global Privacy Control (GPC) signal as an opt-out of sale/share where applicable; because we do not sell or share data for cross-context advertising, this signal currently has no further effect. We do not respond to legacy \"Do Not Track\" headers.",
      ],
    },
    {
      heading: "6. Data retention",
      paragraphs: [
        "We keep account and content data while your account is active. Audit logs of actions taken through the Service are retained for security and accountability. Newsletter emails are retained until you unsubscribe or request deletion. Billing records are kept as required by tax and accounting law (typically 7 years). When you delete your account, we delete or de-identify personal information within 90 days, except backups (deleted on a rolling schedule) and records we must keep by law.",
      ],
    },
    {
      heading: "7. Security",
      paragraphs: [
        "We use encryption in transit (TLS) and at rest, scoped OAuth tokens, approval gating for sensitive actions, rate limiting, idempotency keys to prevent duplicate actions, and access controls limited to personnel who need access to operate the Service. No method of transmission or storage is 100% secure; if we discover a breach affecting your personal information, we will notify you and authorities as required by law.",
      ],
    },
    {
      heading: "8. Your US state privacy rights",
      paragraphs: [
        "Depending on your state of residence (including California, Virginia, Colorado, Connecticut, Utah, Oregon, Texas, Montana and others), you may have some or all of the following rights:",
      ],
      list: [
        "Right to know / access — the categories and specific pieces of personal information we hold about you, the sources, purposes and categories of third parties.",
        "Right to delete — request deletion of personal information, subject to legal exceptions.",
        "Right to correct — request correction of inaccurate personal information.",
        "Right to opt out of sale or sharing — we do not sell or share personal information for cross-context behavioral advertising, so no opt-out is necessary; you may still submit a request to confirm.",
        "Right to limit use of sensitive personal information — we do not use or disclose sensitive personal information for purposes requiring a limit right.",
        "Right to non-discrimination — we will not discriminate against you for exercising any privacy right.",
        "Right to appeal — if we deny your request, you may appeal by replying to our decision email.",
      ],
    },
    {
      heading: "9. Exercising your rights",
      paragraphs: [
        "To exercise any right, email privacy@piggybot.me with the subject \"Privacy request\" from the email associated with your account, or use the contact form at piggybot.me/contact. We will verify your identity (and, for authorized agents, your written permission and the agent's registration where required) before acting. We respond within the time required by applicable law (generally 45 days for CCPA requests, extendable once).",
        "If you are in the EEA, UK or Switzerland, you additionally have rights of access, rectification, erasure, restriction, portability and objection, and may lodge a complaint with your supervisory authority. Our legal bases include contract performance, legitimate interests (security, improvement), consent (newsletters, optional cookies) and legal obligations.",
      ],
    },
    {
      heading: "10. Children's privacy",
      paragraphs: [
        "The Service is not directed to children under 13, and we do not knowingly collect personal information from children under 13 under the Children's Online Privacy Protection Act (COPPA). You must be at least 18 (or the age of majority in your jurisdiction) to hold a paid account. If you believe a child has provided us personal information, contact us and we will delete it.",
      ],
    },
    {
      heading: "11. International data transfers",
      paragraphs: [
        "We are based in the United States and process information in the United States and other countries where our providers operate. Where required, we rely on Standard Contractual Clauses or equivalent safeguards for transfers from the EEA, UK and Switzerland.",
      ],
    },
    {
      heading: "12. Third-party platforms and links",
      paragraphs: [
        "Connected social, advertising and SaaS platforms, and any third-party sites we link to (including our code repository), are governed by their own privacy policies. Your use of each platform through the Service is also subject to that platform's terms and developer policies, including Meta Platform Terms, Google API Services User Data Policy, TikTok for Developers terms, X Developer Agreement, LinkedIn API Terms of Use, Discord, Reddit, Substack, Telegram and Rednote developer terms, as applicable.",
      ],
    },
    {
      heading: "13. Changes to this Policy",
      paragraphs: [
        "We may update this Policy from time to time. We will post the revised version with a new \"Last updated\" date and, for material changes, notify you by email or in-product notice at least 14 days before they take effect. Continued use after the effective date constitutes acceptance.",
      ],
    },
    {
      heading: "14. Contact us",
      paragraphs: [
        "Privacy questions or requests: privacy@piggybot.me. General support: piggybot.me/contact. Postal address: Piggybot, Inc., Attn: Privacy, [registered address on file with our Delaware registered agent].",
      ],
    },
  ],
};

const termsEn: LegalDoc = {
  docTitle: "Terms of Service — Piggybot",
  heading: "Terms of Service",
  updated: "Last updated: August 13, 2026",
  intro: [
    "These Terms of Service (\"Terms\") form a binding agreement between you (\"you\", the individual or the organization you represent) and Piggybot, Inc. (\"Piggybot\", \"we\", \"us\") governing your use of piggybot.me and the Piggybot marketing-automation platform (the \"Service\"). By creating an account, starting a trial or using the Service, you accept these Terms. If you do not agree, do not use the Service.",
  ],
  sections: [
    {
      heading: "1. The Service",
      paragraphs: [
        "Piggybot lets you describe marketing-operations outcomes in plain language and turns them into workflows: content planning and repurposing, AI-drafted copy with brand voice memory, deterministic and AI semantic compliance checks, multi-platform publishing with idempotency protection, unified inbox and comment-to-lead routing, scheduled reporting and advertising guardrails. Actions you mark as sensitive (publishing, replying to customers, changing budgets) require your approval unless you configure an approval policy that allows them automatically.",
      ],
    },
    {
      heading: "2. Eligibility and accounts",
      list: [
        "You must be at least 18 years old and able to form a binding contract.",
        "Provide accurate registration information and keep your credentials and operator tokens confidential. You are responsible for all activity under your account.",
        "One person or legal entity per account; workspace members must be authorized by you.",
        "We may suspend accounts that create risk for other users or connected platforms.",
      ],
    },
    {
      heading: "3. Subscriptions, trials and billing",
      paragraphs: [
        "Paid plans are billed monthly in US dollars and renew automatically until cancelled. Current plans, included connected accounts, task quotas and AI credit allowances are described on the pricing page and form part of these Terms.",
      ],
      list: [
        "Free trial — every paid plan starts with a 7-day free trial including 30 Eco AI credits. At the end of the trial your selected paid plan begins unless you cancel before renewal.",
        "Metering — triggers, filters and approval notifications are free. Only successful actions consume task quota or AI credits (Eco / Standard / Flagship generations consume credits per model cost as shown on the pricing page).",
        "Cost guardrails — we monitor your task quota and supplier costs. At 80% we notify you and the next publish may require approval; at 100% new AI generations and publishing pause automatically until you upgrade or the next cycle begins. Free actions are never blocked.",
        "Overage — additional tasks and AI credit top-ups are charged at the rates shown on the pricing page with your consent.",
        "Cancellation — cancel anytime in the dashboard; access continues to the end of the paid period. Fees are non-refundable except where required by law.",
        "Price changes — we will give at least 30 days' notice before changing your plan's price.",
        "Taxes — prices exclude taxes; you are responsible for applicable sales, use, VAT or similar taxes.",
      ],
    },
    {
      heading: "4. Referral program",
      paragraphs: [
        "Eligible users may earn referral credits (currently 20% of a referred customer's first payment, as shown on the activation page). Credits are issued automatically, apply only to future Piggybot invoices, have no cash value, and may be adjusted or clawed back in cases of refund, chargeback, self-referral, fraud or abuse. We may modify or end the program with notice.",
      ],
    },
    {
      heading: "5. Your content and license",
      paragraphs: [
        "You retain all rights to content you submit or generate with the Service (briefs, brand voice profiles, drafts, published posts, templates — \"Your Content\"). You grant us a worldwide, non-exclusive, royalty-free license to host, process, transmit and display Your Content solely to provide and secure the Service. You represent that you have all rights and permissions needed for Your Content and for the actions you ask the Service to take, including rights in customer data you route through workflows.",
      ],
    },
    {
      heading: "6. AI features; your review responsibility",
      paragraphs: [
        "AI-generated output may be inaccurate, incomplete or inappropriate. Built-in deterministic checks (forbidden words, length) and AI semantic compliance review reduce but do not eliminate risk, and they are not legal, regulatory or professional advice. You are responsible for reviewing and approving output before it is published or sent, and for ensuring published content complies with law (including advertising, endorsement/FTC disclosure, and industry rules) and platform policies.",
      ],
    },
    {
      heading: "7. Connected third-party platforms",
      paragraphs: [
        "When you connect a social, advertising or SaaS account, you authorize us to act on that account within the scopes you grant. You may revoke access at any time via the platform or the dashboard. Your use of each platform remains subject to that platform's terms, developer policies and rate limits (including Meta, Google/YouTube, TikTok, X, LinkedIn, Discord, Reddit, Substack, Telegram, Rednote, HubSpot, Salesforce, Slack and Notion terms, as applicable). We are not responsible for platform outages, suspensions or policy changes. Platforms may suspend or restrict accounts for automated activity; using approval gating and respecting each platform's automation rules is your responsibility.",
      ],
    },
    {
      heading: "8. Acceptable use",
      paragraphs: ["You will not use the Service to:"],
      list: [
        "Violate any law, platform policy or third-party right, including intellectual-property, privacy and publicity rights.",
        "Send spam, unsolicited bulk messages or deceptive advertising; run engagement manipulation, fake accounts or inauthentic behavior.",
        "Publish illegal, harmful, hateful or misleading content, or content exploiting minors.",
        "Probe, scan or test vulnerabilities, bypass metering, rate limits, idempotency or approval controls, or reverse engineer the Service except as permitted by law.",
        "Resell the Service or use it to build a competing product, or submit personal data of others without a lawful basis.",
      ],
    },
    {
      heading: "9. Intellectual property",
      paragraphs: [
        "The Service, including the Piggybot name, mascot artwork, interface, and underlying software, is owned by Piggybot and its licensors and protected by IP laws. These Terms grant you no rights except the limited right to use the Service. Feedback you submit may be used by us without obligation.",
      ],
    },
    {
      heading: "10. Disclaimers",
      paragraphs: [
        "THE SERVICE IS PROVIDED \"AS IS\" AND \"AS AVAILABLE\". TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT AI OUTPUT WILL BE ACCURATE OR COMPLIANT, THAT THE SERVICE WILL BE UNINTERRUPTED, OR THAT ANY PLATFORM INTEGRATION WILL REMAIN AVAILABLE.",
      ],
    },
    {
      heading: "11. Limitation of liability",
      paragraphs: [
        "TO THE MAXIMUM EXTENT PERMITTED BY LAW: (A) WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, LOST PROFITS, LOST DATA, OR COSTS OF SUBSTITUTE SERVICES; AND (B) OUR TOTAL LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE IS LIMITED TO THE AMOUNTS YOU PAID US IN THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO LIABILITY (OR US$100 IF YOU PAID NOTHING). Some jurisdictions do not allow these limits, so they may not apply to you.",
      ],
    },
    {
      heading: "12. Indemnification",
      paragraphs: [
        "You will defend and indemnify Piggybot from claims, damages and expenses (including reasonable attorneys' fees) arising out of Your Content, your use of the Service in violation of these Terms or law, or actions taken on your connected accounts at your direction.",
      ],
    },
    {
      heading: "13. Dispute resolution; arbitration; class-action waiver",
      paragraphs: [
        "PLEASE READ CAREFULLY. Except for small-claims court matters and IP enforcement, any dispute arising from these Terms or the Service will be resolved by binding individual arbitration administered by the American Arbitration Association under its Commercial Arbitration Rules, seated in Wilmington, Delaware, in English. The Federal Arbitration Act governs this section. YOU AND PIGGYBOT WAIVE ANY RIGHT TO A JURY TRIAL AND TO PARTICIPATE IN A CLASS ACTION OR CLASS-WIDE ARBITRATION. You may opt out of arbitration within 30 days of first accepting these Terms by emailing legal@piggybot.me with the subject \"Arbitration opt-out\".",
      ],
    },
    {
      heading: "14. Governing law; venue",
      paragraphs: [
        "These Terms are governed by the laws of the State of Delaware, USA, without regard to conflict-of-laws rules. Where arbitration does not apply, the state and federal courts located in Delaware have exclusive jurisdiction.",
      ],
    },
    {
      heading: "15. Termination",
      paragraphs: [
        "You may stop using the Service and delete your account at any time. We may suspend or terminate access for breach, non-payment or risk to the Service, with notice where practicable. Sections that by nature survive (billing accrued, IP, disclaimers, limitation of liability, indemnity, disputes) survive termination. Upon deletion we handle your data per the Privacy Policy.",
      ],
    },
    {
      heading: "16. Changes to these Terms",
      paragraphs: [
        "We may update these Terms from time to time. Material changes will be notified by email or in-product notice at least 14 days before taking effect. Continued use after the effective date constitutes acceptance.",
      ],
    },
    {
      heading: "17. Contact",
      paragraphs: [
        "Questions about these Terms: legal@piggybot.me. Support: piggybot.me/contact. Piggybot, Inc., Delaware, USA.",
      ],
    },
  ],
};

export const LEGAL_EN = { privacy: privacyEn, terms: termsEn };

/* ------------------------------------------------------------------ */
/* 简体中文                                                             */
/* ------------------------------------------------------------------ */

const privacyZh: LegalDoc = {
  docTitle: "隐私政策 — Piggybot",
  heading: "隐私政策",
  updated: "最近更新：2026 年 8 月 13 日",
  intro: [
    "Piggybot（下称「我们」）运营 piggybot.me 网站及 Piggybot 营销自动化平台（合称「本服务」）。Piggybot 是你在营销运营领域的数字分身：帮助你规划内容、起草文案、执行合规检查、向社交与广告平台发布、路由私信与线索并生成报告——全程受你的审批策略约束。",
    "本政策说明我们收集哪些个人信息、如何使用与共享，以及你享有的选择与权利，包括美国联邦与各州隐私法（如经 CPRA 修订的《加州消费者隐私法》，CCPA）项下的权利。英文版本为准。",
  ],
  sections: [
    {
      heading: "1. 我们收集的信息",
      paragraphs: ["我们通过三种方式收集信息：你主动提供、自动收集、以及你连接的第三方平台。"],
      list: [
        "账户与联系信息——注册或联系支持时提供的姓名、邮箱、密码或单点登录标识、公司与职位。",
        "邮件订阅——你在订阅表单中提交的邮箱地址，由 Google LLC 运营的 Google 表单及关联 Google 表格收集与存储。",
        "已连接平台数据——当你授权社交、广告或 SaaS 账户（如 Instagram、TikTok、YouTube、LinkedIn、X、Discord、Reddit、Substack、Telegram、小红书、Meta/Google/TikTok 广告、HubSpot、Salesforce、Google 表格、Slack 或 Notion），我们会获取 OAuth 令牌及执行你所配置动作所需的数据，如资料、帖子、评论、私信、广告指标与 CRM 记录。",
        "你创建的内容——品牌语气档案、禁用词表、草稿、模板、工作流、审批策略与审批记录。",
        "账单信息——所选套餐、用量计量（task 与 AI credits）及交易记录。支付卡信息由支付处理商处理，不存储于我们的服务器。",
        "使用与设备数据——日志、IP 地址、浏览器类型、页面浏览、功能交互、由 IP 推断的大致位置及 Cookie 标识。",
        "支持与反馈——你联系我们或提交产品反馈时的消息、附件与反馈类别。",
        "推荐数据——参与推荐计划时的推荐链接、成功推荐与奖励余额。",
      ],
    },
    {
      heading: "2. 我们如何使用信息",
      list: [
        "提供、运营与维护本服务，包括执行你配置的工作流并执行你的审批策略。",
        "通过作为处理方的大语言模型供应商生成 AI 草稿、方案、分类与合规检查。",
        "处理交易、计量用量（task 与 AI credits）、执行成本结界并发送账单通知。",
        "发送服务通知（待审批、安全提醒、试用与订阅通知），以及经你同意的产品动态与邮件订阅。",
        "保障服务安全：反欺诈与反滥用、限流、防止重复发布的幂等保护、审计日志与排障。",
        "改进与开发本服务，包括聚合与去标识化分析。",
        "遵守法律、执行服务条款并保护我们、用户与公众的权益。",
      ],
    },
    {
      heading: "3. AI 处理如何运作",
      paragraphs: [
        "当工作流包含 AI 步骤时，相关内容（如你的需求描述、品牌语气档案或帖子草稿）会在数据处理协议约束下发送给大语言模型供应商，仅用于生成你请求的结果。我们配置了多供应商自动故障转移，路由依据可用性与成本控制选择，绝不出售你的数据。在供应商提供退出选项时，我们不使用你的内容训练基础模型，并优先选择其 API 条款默认不保留 API 输入用于训练的供应商。",
        "AI 输出均为草稿。任何内容发布前都会经过确定性检查（禁用词、长度）与 AI 语义合规审查；除非你明确开启自动审批，否则不会发布任何内容、回复任何客户或改动任何预算。",
      ],
    },
    {
      heading: "4. 我们如何共享信息",
      paragraphs: ["我们不出售你的个人信息，也不为跨场景行为广告共享信息。我们仅与以下对象共享："],
      list: [
        "服务提供商/处理方——云托管、数据库、LLM 推理、支付处理、邮件投递、错误监控，以及托管订阅表单与表格的 Google。各方均受合同约束，仅得为向我们提供服务之目的使用信息。",
        "你连接的平台——当你指示本服务发布、回复或同步时，内容会在你的授权下传输至目标平台，并受该平台条款与隐私政策约束。",
        "专业顾问与主管机关——在法律、传票要求或为保护权利与安全所必需时，向律师、审计师、监管机构或执法部门披露。",
        "业务转让——合并、收购、融资或资产出售时，在本政策约束下转让。",
        "经你指示或同意——例如你向团队共享工作流模板。",
      ],
    },
    {
      heading: "5. Cookie 与类似技术",
      paragraphs: [
        "我们使用严格必要的 Cookie（会话、安全、语言偏好），并在法律要求时经你同意使用分析 Cookie 以了解功能使用情况。你可以通过浏览器设置管理 Cookie。在适用法律下，我们将全球隐私控制（GPC）信号视为选择退出出售/共享；由于我们不出售或为跨场景广告共享数据，该信号目前无进一步影响。我们不响应旧版「Do Not Track」标头。",
      ],
    },
    {
      heading: "6. 数据保留",
      paragraphs: [
        "账户与内容数据在账户存续期间保留。通过本服务执行动作的审计日志为安全与问责目的保留。订阅邮箱保留至你退订或请求删除。账单记录按税法与会计法要求保存（通常 7 年）。删除账户后，我们将在 90 天内删除或去标识化个人信息，滚动删除的备份及法律要求保留的记录除外。",
      ],
    },
    {
      heading: "7. 安全",
      paragraphs: [
        "我们采用传输中（TLS）与静态加密、限定范围的 OAuth 令牌、敏感动作审批门禁、限流、防重复动作的幂等键，以及仅限运营所需人员的访问控制。任何传输或存储方式均非 100% 安全；如发现影响你个人信息的安全事件，我们将依法通知你及主管机关。",
      ],
    },
    {
      heading: "8. 美国各州隐私权利",
      paragraphs: ["根据你居住的州（包括加州、弗吉尼亚、科罗拉多、康涅狄格、犹他、俄勒冈、得克萨斯、蒙大拿等），你可能享有以下部分或全部权利："],
      list: [
        "知情/访问权——了解我们持有的个人信息类别与具体内容、来源、用途及第三方类别。",
        "删除权——在法律例外情形下请求删除个人信息。",
        "更正权——请求更正不准确的个人信息。",
        "选择退出出售/共享权——我们不出售个人信息、不为跨场景行为广告共享，因此无需退出；你仍可提交请求以确认。",
        "限制敏感个人信息使用权——我们不会以触发该权利的方式使用或披露敏感个人信息。",
        "反歧视权——行使任何隐私权利不会受到歧视待遇。",
        "申诉权——若请求被拒绝，可回复决定邮件提出申诉。",
      ],
    },
    {
      heading: "9. 如何行使权利",
      paragraphs: [
        "请使用与账户关联的邮箱发送邮件至 privacy@piggybot.me（主题注明「Privacy request」），或通过 piggybot.me/contact 的联系表单提交。我们将在处理前核实你的身份（授权代理人需同时核实你的书面授权及法律要求的代理人登记）。我们将在适用法律要求的期限内答复（CCPA 请求通常为 45 天，可延长一次）。",
        "若你位于欧洲经济区、英国或瑞士，你还享有访问、更正、删除、限制处理、数据可携带及反对的权利，并可向监管机构投诉。我们的法律依据包括合同履行、合法利益（安全、改进）、同意（订阅、可选 Cookie）及法定义务。",
      ],
    },
    {
      heading: "10. 儿童隐私",
      paragraphs: [
        "本服务不面向 13 岁以下儿童，我们不会在《儿童在线隐私保护法》（COPPA）下故意收集 13 岁以下儿童的个人信息。付费账户持有人须年满 18 岁（或所在辖区的成年年龄）。如你发现儿童向我们提供了个人信息，请联系我们删除。",
      ],
    },
    {
      heading: "11. 国际数据传输",
      paragraphs: [
        "我们位于美国，在美国及我们供应商运营的其他国家处理信息。如法律要求，我们将依据标准合同条款或同等保障措施处理来自欧洲经济区、英国及瑞士的传输。",
      ],
    },
    {
      heading: "12. 第三方平台与链接",
      paragraphs: [
        "已连接的社交、广告与 SaaS 平台，以及我们链接的任何第三方网站（包括代码仓库），均受其各自隐私政策约束。你通过本服务使用各平台，还须遵守该平台的条款与开发者政策，包括适用的 Meta 平台条款、Google API 服务用户数据政策、TikTok for Developers 条款、X 开发者协议、LinkedIn API 使用条款、Discord、Reddit、Substack、Telegram 与小红书开发者条款。",
      ],
    },
    {
      heading: "13. 本政策的变更",
      paragraphs: [
        "我们可能不时更新本政策。我们将公布新版本及「最近更新」日期；重大变更将至少提前 14 天通过邮件或产品内通知告知。生效后继续使用即视为接受。",
      ],
    },
    {
      heading: "14. 联系我们",
      paragraphs: [
        "隐私问题或请求：privacy@piggybot.me。一般支持：piggybot.me/contact。邮寄地址：Piggybot, Inc., Attn: Privacy（特拉华州注册代理人备案地址）。",
      ],
    },
  ],
};

const termsZh: LegalDoc = {
  docTitle: "服务条款 — Piggybot",
  heading: "服务条款",
  updated: "最近更新：2026 年 8 月 13 日",
  intro: [
    "本服务条款（「本条款」）构成你（个人或你所代表的组织）与 Piggybot, Inc.（「我们」）之间关于使用 piggybot.me 及 Piggybot 营销自动化平台（「本服务」）的约束性协议。创建账户、开始试用或使用本服务即表示你接受本条款。如不同意，请勿使用本服务。英文版本为准。",
  ],
  sections: [
    {
      heading: "1. 服务内容",
      paragraphs: [
        "Piggybot 让你用自然语言描述营销运营目标，并将其转化为工作流：内容规划与一变多、带品牌语气记忆的 AI 文案、确定性与 AI 语义合规检查、带幂等保护的多平台发布、统一收件箱与评论转线索、定时报告与广告守护。你标记为敏感的动作（发布、回复客户、改动预算）默认需经你审批，除非你配置了允许自动执行的审批策略。",
      ],
    },
    {
      heading: "2. 资格与账户",
      list: [
        "你须年满 18 岁且具备缔约能力。",
        "提供准确的注册信息，妥善保管凭证与操作令牌；你账户下的一切活动由你负责。",
        "每个账户对应一个自然人或法律实体；工作区成员须由你授权。",
        "对给其他用户或连接平台带来风险的账户，我们可能予以暂停。",
      ],
    },
    {
      heading: "3. 订阅、试用与计费",
      paragraphs: [
        "付费套餐以美元按月计费，自动续订直至取消。当前套餐、内含连接账号、task 额度与 AI credits 配额以定价页描述为准，并构成本条款的一部分。",
      ],
      list: [
        "免费试用——每个付费套餐均含 7 天免费试用及 30 个 Eco AI credits。试用期结束且未取消的，将开始计收所选套餐费用。",
        "计量——触发、过滤与审批通知免费；仅成功的动作消耗 task 额度或 AI credits（Eco / Standard / Flagship 生成按定价页所示的模型成本消耗 credits）。",
        "成本结界——我们监控你的 task 额度与供应商成本：达到 80% 时通知你，下一次发布可能需要审批；达到 100% 时自动暂停新的 AI 生成与发布，直至升级或进入下一周期。免费动作永不受限。",
        "超额用量——额外 task 与 AI credits 加购按定价页费率经你同意后收取。",
        "取消——可随时在仪表盘取消，访问权持续至已付费周期结束。除法律要求外，费用不予退还。",
        "价格调整——调整你的套餐价格前至少提前 30 天通知。",
        "税费——价格不含税；适用的销售税、使用税、增值税或类似税费由你承担。",
      ],
    },
    {
      heading: "4. 推荐计划",
      paragraphs: [
        "符合条件的用户可获得推荐奖励（当前为被推荐客户首笔付款的 20%，以激活页所示为准）。奖励自动发放，仅可抵扣未来的 Piggybot 账单，无现金价值；如发生退款、拒付、自我推荐、欺诈或滥用，我们可能调整或追回奖励。我们可在通知后修改或终止该计划。",
      ],
    },
    {
      heading: "5. 你的内容与许可",
      paragraphs: [
        "你保留向本服务提交或通过本服务生成的内容（需求描述、品牌语气档案、草稿、已发布帖子、模板——「你的内容」）的全部权利。你授予我们全球范围、非独占、免版税的许可，仅为提供与保障本服务之目的托管、处理、传输与展示你的内容。你声明你拥有你的内容及你要求本服务执行动作所需的全部权利与授权，包括你经由工作流路由的客户数据的相关权利。",
      ],
    },
    {
      heading: "6. AI 功能与你的审查责任",
      paragraphs: [
        "AI 生成的内容可能不准确、不完整或不适当。内置的确定性检查（禁用词、长度）与 AI 语义合规审查可降低但无法消除风险，且不构成法律、监管或专业意见。你负责在内容发布或发送前审查并批准输出，并确保已发布内容符合法律（包括广告、代言/FTC 披露及行业规则）与平台政策。",
      ],
    },
    {
      heading: "7. 连接的第三方平台",
      paragraphs: [
        "连接社交、广告或 SaaS 账户即授权我们在你授予的权限范围内代你操作。你可以随时通过平台或仪表盘撤销授权。你对各平台的使用仍受该平台条款、开发者政策与速率限制约束（包括适用的 Meta、Google/YouTube、TikTok、X、LinkedIn、Discord、Reddit、Substack、Telegram、小红书、HubSpot、Salesforce、Slack 与 Notion 条款）。我们不对平台故障、账户封禁或政策变更负责。平台可能因自动化活动限制账户；使用审批门禁并遵守各平台自动化规则是你的责任。",
      ],
    },
    {
      heading: "8. 可接受使用",
      paragraphs: ["你不得利用本服务："],
      list: [
        "违反任何法律、平台政策或第三方权利，包括知识产权、隐私权与公开权。",
        "发送垃圾信息、未经请求的群发消息或欺骗性广告；进行互动操纵、虚假账户或不真实行为。",
        "发布违法、有害、仇恨或误导性内容，或侵害未成年人的内容。",
        "探测、扫描或测试漏洞，绕过计量、限流、幂等或审批控制，或在法律允许范围外反向工程本服务。",
        "转售本服务、用以构建竞品，或在缺乏合法依据的情况下提交他人个人数据。",
      ],
    },
    {
      heading: "9. 知识产权",
      paragraphs: [
        "本服务（包括 Piggybot 名称、吉祥物形象、界面与底层软件）归 Piggybot 及其许可方所有并受知识产权法保护。除使用本服务的有限权利外，本条款不授予你任何权利。你提交的反馈可由我们自由使用而无须承担义务。",
      ],
    },
    {
      heading: "10. 免责声明",
      paragraphs: [
        "本服务按「现状」与「可用」状态提供。在法律允许的最大范围内，我们否认一切明示或默示保证，包括适销性、特定用途适用性与不侵权。我们不保证 AI 输出准确或合规、本服务不中断，或任何平台集成持续可用。",
      ],
    },
    {
      heading: "11. 责任限制",
      paragraphs: [
        "在法律允许的最大范围内：（A）我们不对间接、附带、特殊、后果性或惩罚性损害、利润损失、数据损失或替代服务成本负责；（B）我们就本服务相关全部索赔的总责任，以责任事件前 12 个月内你实际支付给我们的金额为限（未付费者为 100 美元）。部分辖区不允许上述限制，故可能不适用于你。",
      ],
    },
    {
      heading: "12. 赔偿",
      paragraphs: [
        "因你的内容、你违反本条款或法律使用本服务、或按你指示在你连接的账户上执行的动作而引发的索赔、损失与费用（含合理律师费），由你负责抗辩并赔偿 Piggybot。",
      ],
    },
    {
      heading: "13. 争议解决；仲裁；集体诉讼弃权",
      paragraphs: [
        "请仔细阅读。除小额法庭事项与知识产权执法外，因本条款或本服务产生的任何争议，均由美国仲裁协会按其商事仲裁规则在特拉华州威尔明顿以英文进行具有约束力的个人仲裁解决。《联邦仲裁法》适用于本条。你与 PIGGYBOT 均放弃陪审团审判及参与集体诉讼或集体仲裁的权利。你可以在首次接受本条款后 30 天内发送邮件至 legal@piggybot.me（主题「Arbitration opt-out」）选择退出仲裁。",
      ],
    },
    {
      heading: "14. 管辖法律与管辖地",
      paragraphs: [
        "本条款受美国特拉华州法律管辖，不适用冲突法规则。不适用仲裁时，特拉华州的州法院与联邦法院拥有专属管辖权。",
      ],
    },
    {
      heading: "15. 终止",
      paragraphs: [
        "你可以随时停止使用本服务并删除账户。因违约、欠费或对本服务造成风险，我们可能在可行时经通知后暂停或终止访问。性质上应当存续的条款（已产生费用、知识产权、免责声明、责任限制、赔偿、争议解决）在终止后继续有效。删除后，我们按隐私政策处理你的数据。",
      ],
    },
    {
      heading: "16. 条款变更",
      paragraphs: [
        "我们可能不时更新本条款。重大变更将至少提前 14 天通过邮件或产品内通知告知。生效后继续使用即视为接受。",
      ],
    },
    {
      heading: "17. 联系我们",
      paragraphs: [
        "条款相关问题：legal@piggybot.me。支持：piggybot.me/contact。Piggybot, Inc.，美国特拉华州。",
      ],
    },
  ],
};

export const LEGAL_ZH = { privacy: privacyZh, terms: termsZh };

/* ------------------------------------------------------------------ */
/* Español                                                              */
/* ------------------------------------------------------------------ */

const privacyEs: LegalDoc = {
  docTitle: "Política de Privacidad — Piggybot",
  heading: "Política de Privacidad",
  updated: "Última actualización: 13 de agosto de 2026",
  intro: [
    "Piggybot («nosotros») opera el sitio piggybot.me y la plataforma de automatización de marketing Piggybot (en conjunto, el «Servicio»). Piggybot es tu gemelo digital para operaciones de marketing: te ayuda a planificar contenido, redactar textos, ejecutar revisiones de cumplimiento, publicar en plataformas sociales y publicitarias, enrutar mensajes y leads, y generar informes — siempre bajo tus políticas de aprobación.",
    "Esta Política explica qué información personal recopilamos, cómo la usamos y compartimos, y las opciones y derechos que tienes, incluidos los derechos bajo las leyes de privacidad federales y estatales de EE. UU., como la Ley de Privacidad del Consumidor de California enmendada por la CPRA («CCPA»). La versión en inglés prevalece.",
  ],
  sections: [
    {
      heading: "1. Información que recopilamos",
      paragraphs: ["Recopilamos información de tres formas: la que nos das, la recopilada automáticamente y la de plataformas de terceros que conectas."],
      list: [
        "Información de cuenta y contacto — nombre, correo electrónico, contraseña o identificador de inicio de sesión único, empresa y cargo, al crear una cuenta o contactar soporte.",
        "Suscripciones al boletín — el correo que envías en nuestro formulario, recopilado y almacenado mediante Google Forms y una hoja de Google vinculada, operados por Google LLC.",
        "Datos de plataformas conectadas — al autorizar cuentas sociales, publicitarias o SaaS (por ejemplo Instagram, TikTok, YouTube, LinkedIn, X, Discord, Reddit, Substack, Telegram, Rednote, anuncios de Meta/Google/TikTok, HubSpot, Salesforce, Google Sheets, Slack o Notion), recibimos tokens OAuth y los datos necesarios para ejecutar las acciones que configuras: perfiles, publicaciones, comentarios, mensajes, métricas de anuncios y registros de CRM.",
        "Contenido que creas — perfiles de voz de marca, listas de palabras prohibidas, borradores, plantillas, flujos de trabajo, políticas y decisiones de aprobación.",
        "Información de facturación — plan elegido, medidores de uso (tareas y créditos de IA) e historial de transacciones. Los datos de tu tarjeta los procesa nuestro proveedor de pagos y nunca se almacenan en nuestros servidores.",
        "Datos de uso y dispositivo — registros, dirección IP, tipo de navegador, páginas vistas, interacciones, ubicación aproximada derivada de la IP e identificadores de cookies.",
        "Soporte y comentarios — mensajes, archivos adjuntos y categoría cuando nos contactas o envías comentarios.",
        "Datos de referidos — enlaces de referido, registros acreditados y saldos de recompensa al participar en el programa de referidos.",
      ],
    },
    {
      heading: "2. Cómo usamos la información",
      list: [
        "Proporcionar, operar y mantener el Servicio, incluida la ejecución de tus flujos de trabajo y el cumplimiento de tus políticas de aprobación.",
        "Generar borradores, planes, clasificaciones y revisiones de cumplimiento asistidos por IA mediante proveedores de modelos de lenguaje que actúan como encargados del tratamiento.",
        "Procesar transacciones, medir el uso (tareas y créditos de IA), aplicar límites de costo y enviar avisos de facturación.",
        "Enviar comunicaciones del servicio (aprobaciones pendientes, alertas de seguridad, avisos de prueba y suscripción) y, si lo aceptas, novedades y boletines.",
        "Proteger el Servicio: prevención de fraude y abuso, límites de velocidad, protección de idempotencia contra publicaciones duplicadas, registros de auditoría y depuración.",
        "Mejorar y desarrollar el Servicio, incluidas analíticas agregadas y desidentificadas.",
        "Cumplir la ley, hacer cumplir nuestros Términos y proteger nuestros derechos, usuarios y el público.",
      ],
    },
    {
      heading: "3. Cómo funciona el procesamiento de IA",
      paragraphs: [
        "Cuando un flujo incluye un paso de IA, el contenido relevante (tu brief, perfil de voz de marca o borrador) se envía a un proveedor de modelos de lenguaje bajo un acuerdo de procesamiento de datos, únicamente para producir el resultado solicitado. Operamos varios proveedores con conmutación automática; el enrutamiento se elige por disponibilidad y control de costos, nunca para vender tus datos. No usamos tu contenido para entrenar modelos fundacionales cuando el proveedor ofrece exclusión, y elegimos proveedores cuyos términos de API no retienen entradas para entrenamiento por defecto.",
        "Los resultados de IA son borradores. Se aplican verificaciones deterministas (palabras prohibidas, límites de longitud) y revisión semántica de cumplimiento por IA antes de cualquier publicación y, salvo que actives la aprobación automática, nada se publica, ningún cliente recibe respuesta y ningún presupuesto cambia sin tu aprobación.",
      ],
    },
    {
      heading: "4. Cómo compartimos información",
      paragraphs: ["No vendemos tu información personal ni la compartimos para publicidad conductual de contexto cruzado. Solo la compartimos con:"],
      list: [
        "Proveedores de servicios / encargados — alojamiento en la nube, bases de datos, inferencia de LLM, procesamiento de pagos, envío de correo, monitoreo de errores y Google (que aloja nuestro formulario y hoja del boletín). Todos están obligados por contrato a usar la información solo para prestarnos servicios.",
        "Plataformas que conectas — cuando ordenas al Servicio publicar, responder o sincronizar, el contenido se transmite a la plataforma de destino bajo tu propia autorización y sus términos y política de privacidad.",
        "Asesores profesionales y autoridades — abogados, auditores, reguladores o fuerzas del orden cuando lo exija la ley, una citación o la protección de derechos y seguridad.",
        "Transferencias comerciales — en fusiones, adquisiciones, financiación o venta de activos, conforme a esta Política.",
        "Con tu instrucción o consentimiento — por ejemplo, al compartir una plantilla de flujo con tu equipo.",
      ],
    },
    {
      heading: "5. Cookies y tecnologías similares",
      paragraphs: [
        "Usamos cookies estrictamente necesarias (sesión, seguridad, preferencia de idioma) y, con tu consentimiento cuando se requiera, cookies de analítica para entender el uso de funciones. Puedes controlar las cookies desde tu navegador. Respetamos la señal Global Privacy Control (GPC) como exclusión de venta/compartición donde aplique; como no vendemos ni compartimos datos para publicidad de contexto cruzado, la señal no tiene efecto adicional. No respondemos a los encabezados heredados «Do Not Track».",
      ],
    },
    {
      heading: "6. Conservación de datos",
      paragraphs: [
        "Conservamos los datos de cuenta y contenido mientras tu cuenta esté activa. Los registros de auditoría de acciones se conservan por seguridad y responsabilidad. Los correos del boletín se conservan hasta que te des de baja o solicites su eliminación. Los registros de facturación se conservan según lo exijan las leyes fiscales y contables (normalmente 7 años). Al eliminar tu cuenta, eliminamos o desidentificamos la información personal en un plazo de 90 días, salvo copias de seguridad (eliminadas de forma rotativa) y registros exigidos por ley.",
      ],
    },
    {
      heading: "7. Seguridad",
      paragraphs: [
        "Usamos cifrado en tránsito (TLS) y en reposo, tokens OAuth de alcance limitado, aprobación obligatoria para acciones sensibles, límites de velocidad, claves de idempotencia contra acciones duplicadas y controles de acceso restringidos al personal que los necesita. Ningún método de transmisión o almacenamiento es 100 % seguro; si descubrimos una brecha que afecte a tu información personal, te notificaremos a ti y a las autoridades según lo exija la ley.",
      ],
    },
    {
      heading: "8. Tus derechos de privacidad estatales en EE. UU.",
      paragraphs: ["Según tu estado de residencia (incluidos California, Virginia, Colorado, Connecticut, Utah, Oregón, Texas, Montana y otros), puedes tener algunos o todos estos derechos:"],
      list: [
        "Derecho a saber / acceder — las categorías y piezas específicas de información personal que tenemos sobre ti, sus fuentes, fines y categorías de terceros.",
        "Derecho de eliminación — solicitar la eliminación de información personal, sujeto a excepciones legales.",
        "Derecho de rectificación — solicitar la corrección de información inexacta.",
        "Derecho a optar por no vender ni compartir — no vendemos ni compartimos información para publicidad conductual de contexto cruzado, por lo que no hace falta excluirse; aun así puedes enviar una solicitud para confirmarlo.",
        "Derecho a limitar el uso de información sensible — no usamos ni divulgamos información personal sensible para fines que activen este derecho.",
        "Derecho a no discriminación — no te discriminaremos por ejercer tus derechos de privacidad.",
        "Derecho de apelación — si denegamos tu solicitud, puedes apelar respondiendo a nuestro correo de decisión.",
      ],
    },
    {
      heading: "9. Cómo ejercer tus derechos",
      paragraphs: [
        "Para ejercer cualquier derecho, escribe a privacy@piggybot.me con el asunto «Privacy request» desde el correo asociado a tu cuenta, o usa el formulario en piggybot.me/contact. Verificaremos tu identidad (y, para agentes autorizados, tu permiso por escrito y el registro del agente cuando se requiera) antes de actuar. Respondemos dentro del plazo legal (generalmente 45 días para solicitudes CCPA, prorrogable una vez).",
        "Si estás en el EEE, Reino Unido o Suiza, tienes además derechos de acceso, rectificación, supresión, limitación, portabilidad y oposición, y puedes reclamar ante tu autoridad de control. Nuestras bases jurídicas incluyen la ejecución del contrato, intereses legítimos (seguridad, mejora), consentimiento (boletines, cookies opcionales) y obligaciones legales.",
      ],
    },
    {
      heading: "10. Privacidad de menores",
      paragraphs: [
        "El Servicio no está dirigido a menores de 13 años y no recopilamos a sabiendas información personal de menores de 13 conforme a la COPPA. Debes tener al menos 18 años (o la mayoría de edad en tu jurisdicción) para tener una cuenta de pago. Si crees que un menor nos ha proporcionado información, contáctanos y la eliminaremos.",
      ],
    },
    {
      heading: "11. Transferencias internacionales",
      paragraphs: [
        "Tenemos sede en Estados Unidos y procesamos información en EE. UU. y otros países donde operan nuestros proveedores. Cuando se requiera, nos apoyamos en Cláusulas Contractuales Tipo o garantías equivalentes para transferencias desde el EEE, Reino Unido y Suiza.",
      ],
    },
    {
      heading: "12. Plataformas y enlaces de terceros",
      paragraphs: [
        "Las plataformas sociales, publicitarias y SaaS conectadas, y cualquier sitio de terceros enlazado (incluido nuestro repositorio de código), se rigen por sus propias políticas de privacidad. Tu uso de cada plataforma a través del Servicio también está sujeto a sus términos y políticas de desarrollador, incluidos los Términos de la Plataforma de Meta, la Política de Datos de Usuario de los Servicios API de Google, los términos de TikTok for Developers, el Acuerdo de Desarrollador de X, los Términos de Uso de la API de LinkedIn y los términos de Discord, Reddit, Substack, Telegram y Rednote, según corresponda.",
      ],
    },
    {
      heading: "13. Cambios en esta Política",
      paragraphs: [
        "Podemos actualizar esta Política ocasionalmente. Publicaremos la versión revisada con una nueva fecha de «Última actualización» y, ante cambios sustanciales, te avisaremos por correo o aviso en el producto al menos 14 días antes de su entrada en vigor. El uso continuado tras la fecha efectiva constituye aceptación.",
      ],
    },
    {
      heading: "14. Contáctanos",
      paragraphs: [
        "Preguntas o solicitudes de privacidad: privacy@piggybot.me. Soporte general: piggybot.me/contact. Dirección postal: Piggybot, Inc., Attn: Privacy (dirección registrada ante nuestro agente registrado en Delaware).",
      ],
    },
  ],
};

const termsEs: LegalDoc = {
  docTitle: "Términos de Servicio — Piggybot",
  heading: "Términos de Servicio",
  updated: "Última actualización: 13 de agosto de 2026",
  intro: [
    "Estos Términos de Servicio («Términos») constituyen un acuerdo vinculante entre tú (la persona u organización que representas) y Piggybot, Inc. («nosotros») que rige el uso de piggybot.me y de la plataforma de automatización de marketing Piggybot (el «Servicio»). Al crear una cuenta, iniciar una prueba o usar el Servicio, aceptas estos Términos. Si no estás de acuerdo, no uses el Servicio. La versión en inglés prevalece.",
  ],
  sections: [
    {
      heading: "1. El Servicio",
      paragraphs: [
        "Piggybot te permite describir resultados de operaciones de marketing en lenguaje natural y convertirlos en flujos de trabajo: planificación y reutilización de contenido, textos redactados por IA con memoria de voz de marca, revisiones de cumplimiento deterministas y semánticas, publicación multiplataforma con protección de idempotencia, bandeja unificada y conversión de comentarios en leads, informes programados y guardianes de anuncios. Las acciones que marques como sensibles (publicar, responder a clientes, cambiar presupuestos) requieren tu aprobación, salvo que configures una política que las permita automáticamente.",
      ],
    },
    {
      heading: "2. Elegibilidad y cuentas",
      list: [
        "Debes tener al menos 18 años y capacidad para contratar.",
        "Proporciona información de registro exacta y mantén confidenciales tus credenciales y tokens de operador. Eres responsable de toda la actividad de tu cuenta.",
        "Una persona o entidad jurídica por cuenta; los miembros del espacio de trabajo deben estar autorizados por ti.",
        "Podemos suspender cuentas que generen riesgo para otros usuarios o plataformas conectadas.",
      ],
    },
    {
      heading: "3. Suscripciones, pruebas y facturación",
      paragraphs: [
        "Los planes de pago se facturan mensualmente en dólares estadounidenses y se renuevan automáticamente hasta su cancelación. Los planes vigentes, cuentas conectadas incluidas, cuotas de tareas y asignaciones de créditos de IA se describen en la página de precios y forman parte de estos Términos.",
      ],
      list: [
        "Prueba gratuita — todo plan de pago comienza con 7 días gratis y 30 créditos Eco de IA. Al finalizar la prueba comenzará el plan elegido salvo que canceles antes de la renovación.",
        "Medición — los disparadores, filtros y notificaciones de aprobación son gratuitos. Solo las acciones exitosas consumen cuota de tareas o créditos de IA (las generaciones Eco / Standard / Flagship consumen créditos según el costo del modelo indicado en la página de precios).",
        "Límites de costo — supervisamos tu cuota de tareas y los costos de proveedores. Al 80 % te avisamos y la siguiente publicación puede requerir aprobación; al 100 % las nuevas generaciones de IA y publicaciones se pausan automáticamente hasta que mejores el plan o comience el siguiente ciclo. Las acciones gratuitas nunca se bloquean.",
        "Excedentes — las tareas adicionales y recargas de créditos se cobran a las tarifas de la página de precios con tu consentimiento.",
        "Cancelación — cancela cuando quieras desde el panel; el acceso continúa hasta el fin del período pagado. Las tarifas no son reembolsables salvo que la ley lo exija.",
        "Cambios de precio — avisaremos con al menos 30 días antes de cambiar el precio de tu plan.",
        "Impuestos — los precios no incluyen impuestos; eres responsable de los impuestos sobre ventas, uso, IVA o similares aplicables.",
      ],
    },
    {
      heading: "4. Programa de referidos",
      paragraphs: [
        "Los usuarios elegibles pueden ganar créditos de referido (actualmente el 20 % del primer pago del cliente referido, según la página de activación). Los créditos se emiten automáticamente, solo aplican a futuras facturas de Piggybot, no tienen valor en efectivo y pueden ajustarse o recuperarse en caso de reembolso, contracargo, autoreferencia, fraude o abuso. Podemos modificar o finalizar el programa con aviso.",
      ],
    },
    {
      heading: "5. Tu contenido y licencia",
      paragraphs: [
        "Conservas todos los derechos sobre el contenido que envías o generas con el Servicio (briefs, perfiles de voz de marca, borradores, publicaciones, plantillas — «Tu Contenido»). Nos otorgas una licencia mundial, no exclusiva y libre de regalías para alojar, procesar, transmitir y mostrar Tu Contenido únicamente para proporcionar y proteger el Servicio. Declaras que tienes todos los derechos y permisos necesarios sobre Tu Contenido y sobre las acciones que pides al Servicio, incluidos los derechos sobre datos de clientes que enrutas por los flujos.",
      ],
    },
    {
      heading: "6. Funciones de IA; tu responsabilidad de revisión",
      paragraphs: [
        "Los resultados de IA pueden ser inexactos, incompletos o inapropiados. Las verificaciones deterministas integradas (palabras prohibidas, longitud) y la revisión semántica de cumplimiento reducen el riesgo pero no lo eliminan, y no constituyen asesoría legal, regulatoria ni profesional. Eres responsable de revisar y aprobar los resultados antes de publicarlos o enviarlos, y de garantizar que el contenido publicado cumpla la ley (incluidas las normas de publicidad, respaldo/divulgación FTC e industria) y las políticas de cada plataforma.",
      ],
    },
    {
      heading: "7. Plataformas de terceros conectadas",
      paragraphs: [
        "Al conectar una cuenta social, publicitaria o SaaS, nos autorizas a actuar en ella dentro de los alcances concedidos. Puedes revocar el acceso en cualquier momento desde la plataforma o el panel. Tu uso de cada plataforma sigue sujeto a sus términos, políticas de desarrollador y límites de velocidad (incluidos los de Meta, Google/YouTube, TikTok, X, LinkedIn, Discord, Reddit, Substack, Telegram, Rednote, HubSpot, Salesforce, Slack y Notion, según corresponda). No somos responsables de caídas, suspensiones o cambios de política de las plataformas. Las plataformas pueden restringir cuentas por actividad automatizada; usar la aprobación obligatoria y respetar las reglas de automatización de cada plataforma es tu responsabilidad.",
      ],
    },
    {
      heading: "8. Uso aceptable",
      paragraphs: ["No usarás el Servicio para:"],
      list: [
        "Violar leyes, políticas de plataformas o derechos de terceros, incluidos derechos de propiedad intelectual, privacidad y publicidad.",
        "Enviar spam, mensajes masivos no solicitados o publicidad engañosa; manipular interacciones, crear cuentas falsas o comportamiento no auténtico.",
        "Publicar contenido ilegal, dañino, de odio o engañoso, o que explote a menores.",
        "Sondear o probar vulnerabilidades, eludir la medición, los límites de velocidad, la idempotencia o los controles de aprobación, o realizar ingeniería inversa salvo que la ley lo permita.",
        "Revender el Servicio, usarlo para crear un producto competidor o enviar datos personales de terceros sin base legal.",
      ],
    },
    {
      heading: "9. Propiedad intelectual",
      paragraphs: [
        "El Servicio — incluidos el nombre Piggybot, la mascota, la interfaz y el software subyacente — pertenece a Piggybot y sus licenciantes y está protegido por leyes de propiedad intelectual. Estos Términos solo te conceden el derecho limitado de usar el Servicio. Los comentarios que envíes podemos usarlos sin obligación alguna.",
      ],
    },
    {
      heading: "10. Exención de garantías",
      paragraphs: [
        "EL SERVICIO SE PROPORCIONA «TAL CUAL» Y «SEGÚN DISPONIBILIDAD». EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY, RECHAZAMOS TODA GARANTÍA, EXPRESA O IMPLÍCITA, INCLUIDAS LAS DE COMERCIABILIDAD, IDONEIDAD PARA UN FIN PARTICULAR Y NO INFRACCIÓN. NO GARANTIZAMOS QUE LOS RESULTADOS DE IA SEAN EXACTOS O CONFORMES, QUE EL SERVICIO SEA ININTERRUMPIDO NI QUE TODA INTEGRACIÓN SIGA DISPONIBLE.",
      ],
    },
    {
      heading: "11. Limitación de responsabilidad",
      paragraphs: [
        "EN LA MÁXIMA MEDIDA PERMITIDA POR LA LEY: (A) NO SOMOS RESPONSABLES DE DAÑOS INDIRECTOS, INCIDENTALES, ESPECIALES, CONSECUENTES O PUNITIVOS, LUCRO CESANTE, PÉRDIDA DE DATOS NI COSTOS DE SERVICIOS SUSTITUTOS; Y (B) NUESTRA RESPONSABILIDAD TOTAL POR TODAS LAS RECLAMACIONES RELACIONADAS CON EL SERVICIO SE LIMITA A LO QUE NOS PAGASTE EN LOS 12 MESES ANTERIORES AL HECHO (O 100 USD SI NO PAGASTE NADA). Algunas jurisdicciones no permiten estos límites, por lo que pueden no aplicarte.",
      ],
    },
    {
      heading: "12. Indemnización",
      paragraphs: [
        "Defenderás e indemnizarás a Piggybot frente a reclamaciones, daños y gastos (incluidos honorarios razonables de abogados) derivados de Tu Contenido, tu uso del Servicio en violación de estos Términos o de la ley, o las acciones ejecutadas en tus cuentas conectadas bajo tu dirección.",
      ],
    },
    {
      heading: "13. Resolución de disputas; arbitraje; renuncia a acciones colectivas",
      paragraphs: [
        "LEE CON ATENCIÓN. Salvo asuntos de tribunales de reclamos menores y protección de propiedad intelectual, cualquier disputa derivada de estos Términos o del Servicio se resolverá mediante arbitraje individual vinculante administrado por la American Arbitration Association según sus Reglas de Arbitraje Comercial, con sede en Wilmington, Delaware, en inglés. La Ley Federal de Arbitraje rige esta sección. TÚ Y PIGGYBOT RENUNCIAN AL JUICIO POR JURADO Y A PARTICIPAR EN DEMANDAS O ARBITRAJES COLECTIVOS. Puedes excluirte del arbitraje dentro de los 30 días de aceptar estos Términos escribiendo a legal@piggybot.me con el asunto «Arbitration opt-out».",
      ],
    },
    {
      heading: "14. Ley aplicable y jurisdicción",
      paragraphs: [
        "Estos Términos se rigen por las leyes del Estado de Delaware, EE. UU., sin perjuicio de normas de conflicto de leyes. Cuando el arbitraje no aplique, los tribunales estatales y federales de Delaware tendrán jurisdicción exclusiva.",
      ],
    },
    {
      heading: "15. Terminación",
      paragraphs: [
        "Puedes dejar de usar el Servicio y eliminar tu cuenta en cualquier momento. Podemos suspender o terminar el acceso por incumplimiento, falta de pago o riesgo para el Servicio, con aviso cuando sea posible. Las secciones que por su naturaleza sobreviven (facturación devengada, propiedad intelectual, exenciones, limitación de responsabilidad, indemnización, disputas) siguen vigentes tras la terminación. Tras la eliminación tratamos tus datos según la Política de Privacidad.",
      ],
    },
    {
      heading: "16. Cambios en estos Términos",
      paragraphs: [
        "Podemos actualizar estos Términos ocasionalmente. Los cambios sustanciales se notificarán por correo o aviso en el producto al menos 14 días antes de su entrada en vigor. El uso continuado tras la fecha efectiva constituye aceptación.",
      ],
    },
    {
      heading: "17. Contacto",
      paragraphs: [
        "Preguntas sobre estos Términos: legal@piggybot.me. Soporte: piggybot.me/contact. Piggybot, Inc., Delaware, EE. UU.",
      ],
    },
  ],
};

export const LEGAL_ES = { privacy: privacyEs, terms: termsEs };

export const LEGAL: Record<Lang, { privacy: LegalDoc; terms: LegalDoc }> = {
  en: LEGAL_EN,
  zh: LEGAL_ZH,
  es: LEGAL_ES,
};

export type LegalKind = "privacy" | "terms";
