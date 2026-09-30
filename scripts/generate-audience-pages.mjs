import { readFile, writeFile, mkdir } from "node:fs/promises";
const root = new URL("../", import.meta.url);
const zh = JSON.parse(
  await readFile(new URL("src/audience/landing-zh.json", root), "utf8"),
);
const translations = JSON.parse(
  await readFile(
    new URL("src/audience/landing-translations.json", root),
    "utf8",
  ),
);
const e = (v) =>
  String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const path = (lang, slug = "") =>
  `${lang === "en" ? "" : `/${lang}`}/${slug ? `for/${slug}/` : ""}`;
const shared = {
  en: {
    skip: "Skip to content",
    plans: "Choose a plan",
    sample: "Example report",
    tabs: ["Insight", "Source evidence", "Next step"],
    note: "A little note for your next decision ↘",
    human: "Example data · Check every finding",
    quoteNote: "One example citation; not a full-dataset statistic.",
    example: "See an example report ↓",
    trial: "7-day trial · 30 Eco credits · Then",
    mo: "/ month",
    familiar: "When feedback is scattered, useful signals get lost.",
    value: "Get a result. Check its evidence. Keep what matters.",
    workflow: "From one source to a useful next step.",
    context:
      "You bring the context. Piggybot organizes the evidence. You decide what to keep.",
    steps: [
      "Import your text or CSV",
      "Read results and check sources",
      "Save your review and focus",
    ],
    stepCopy: [
      "Name the source and confirm the scope before paid processing.",
      "Open the original text behind a finding and judge it in context.",
      "Keep reviewed findings in your workspace and reopen them from the report library.",
    ],
    priceTitle: "Try one real source. Choose your next step.",
    flexible: "All three scenarios use the same account. Choose any plan.",
    after: "Renews monthly after the 7-day trial",
    credits: "AI credits / month",
    tasks: "tasks / month",
    trialCredits: "Trial includes 30 Eco credits",
    choose: "Choose",
    priceNote:
      "Prices in USD. Trial eligibility, taxes and billing dates are confirmed at checkout. Manage or cancel your subscription in billing before renewal. AI credits and tasks are metered separately.",
    faq: "Before you start",
    faqItems: [
      [
        "Do I need to connect an account?",
        "Start by pasting text or uploading a CSV you have permission to analyze. No social account connection is required for this workflow.",
      ],
      [
        "Are these actual customer results?",
        "No. The report, quotes and next step shown here are clearly labeled examples, not customer outcomes.",
      ],
      [
        "What happens after I subscribe?",
        "Your selected scenario continues through sign-in and Stripe checkout. Once your subscription is verified, import a source, check the evidence and save your review. Existing subscribers can continue in the same workspace.",
      ],
      [
        "Does this guarantee better results?",
        "No. AI findings need human review. Citations are evidence, not full-dataset frequency estimates or proof of business impact.",
      ],
    ],
    final: "Make your first report useful.",
    footer: "Keep your judgment. Let Piggybot do the sorting.",
    privacy: "Privacy",
    terms: "Terms",
    login: "Already subscribed? Open this workflow",
    start: "Start trial",
    back: "Home",
  },
  es: {
    skip: "Saltar al contenido",
    plans: "Elegir plan",
    sample: "Informe de ejemplo",
    tabs: ["Hallazgo", "Evidencia original", "Siguiente paso"],
    note: "Una nota para tu próxima decisión ↘",
    human: "Datos de ejemplo · Revisa cada conclusión",
    quoteNote:
      "Una cita de ejemplo; no es una estadística del conjunto completo.",
    example: "Ver un informe de ejemplo ↓",
    trial: "Prueba de 7 días · 30 créditos Eco · Después",
    mo: "/ mes",
    familiar: "Cuando los comentarios se dispersan, las señales se pierden.",
    value: "Obtén resultados. Revisa las fuentes. Guarda lo importante.",
    workflow: "De una fuente a un siguiente paso útil.",
    context:
      "Tú aportas el contexto. Piggybot organiza la evidencia. Tú decides qué guardar.",
    steps: [
      "Importa texto o CSV",
      "Lee resultados y revisa fuentes",
      "Guarda tu revisión y prioridades",
    ],
    stepCopy: [
      "Nombra la fuente y confirma el alcance antes del procesamiento de pago.",
      "Abre el texto original detrás de un hallazgo y evalúalo en contexto.",
      "Guarda los hallazgos revisados y vuelve a abrirlos desde la biblioteca.",
    ],
    priceTitle: "Prueba con datos reales. Elige tu siguiente paso.",
    flexible:
      "Una cuenta para los tres escenarios. Puedes elegir cualquier plan.",
    after: "Renovación mensual tras la prueba de 7 días",
    credits: "créditos AI / mes",
    tasks: "tareas / mes",
    trialCredits: "Prueba con 30 créditos Eco",
    choose: "Elegir",
    priceNote:
      "Precios en USD. La elegibilidad, impuestos y fechas se confirman al pagar. Gestiona o cancela la suscripción en facturación antes de la renovación. Los créditos AI y las tareas se miden por separado.",
    faq: "Antes de empezar",
    faqItems: [
      [
        "¿Necesito conectar una cuenta?",
        "Empieza pegando texto o subiendo un CSV que tengas permiso para analizar. Este flujo no requiere conectar una cuenta social.",
      ],
      [
        "¿Son resultados de clientes reales?",
        "No. El informe, las citas y el siguiente paso son ejemplos ilustrativos, no resultados de clientes.",
      ],
      [
        "¿Qué pasa después de suscribirme?",
        "Tu escenario se conserva al iniciar sesión y pagar en Stripe. Tras verificar la suscripción, importa una fuente, revisa la evidencia y guarda tu revisión. Los suscriptores actuales continúan en su espacio.",
      ],
      [
        "¿Garantiza mejores resultados?",
        "No. Revisa las conclusiones de la IA. Las citas son evidencia, no frecuencias del conjunto completo ni pruebas de impacto comercial.",
      ],
    ],
    final: "Haz que tu primer informe sea útil.",
    footer: "Tú decides. Piggybot organiza.",
    privacy: "Privacidad",
    terms: "Términos",
    login: "¿Ya tienes suscripción? Abrir este flujo",
    start: "Iniciar prueba",
    back: "Inicio",
  },
  zh: {
    skip: "跳至主要内容",
    plans: "选择方案",
    sample: "示例报告",
    tabs: ["洞察", "原始证据", "下一步"],
    note: "给你的下一次判断，一张工作便笺 ↘",
    human: "示例数据 · 输出需人工核对",
    quoteNote: "这里只展示一条示例引用，不代表全量统计。",
    example: "先看看报告示例 ↓",
    trial: "7 天试用 · 30 Eco credits · 试用后",
    mo: "/ 月",
    familiar: "不是你不够努力，是线索太零散。",
    value: "获得结果、核对证据、保存复用。",
    workflow: "从一份素材，走到一个明确的下一步。",
    context: "你提供上下文，Piggybot 整理线索。每一步，仍由你掌握方向。",
    steps: [
      "带上你的文本或 CSV",
      "查看结果，核对原始证据",
      "保存核对与关注重点",
    ],
    stepCopy: [
      "填写素材名称与范围，预览确认后再开始付费处理。",
      "打开每条结论对应的原文，在上下文中判断是否采用。",
      "把核对后的重点保存在工作区，下次从报告库重新打开。",
    ],
    priceTitle: "先试一份真实素材，再决定长期同行。",
    flexible: "三种场景共用一个账号，不按用户身份锁定套餐，可自由选择。",
    after: "7 天试用后按月续订",
    credits: "AI credits / 月",
    tasks: "task / 月",
    trialCredits: "试用含 30 Eco credits",
    choose: "选择",
    priceNote:
      "价格为 USD。试用资格、税费和扣款日期以结账页为准，可在账单中管理或取消订阅。试用结束后按所选月付方案续订，AI credits 与 task 分别计量。",
    faq: "你可能还想知道",
    faqItems: [
      [
        "需要先连接社交账号吗？",
        "可以先粘贴文本或上传有权处理的 CSV，无需先连接社交账号就能开始这条工作流。",
      ],
      [
        "示例数据是实际客户的结果吗？",
        "不是。评论、报告与下一步都是标明的演示数据，用于展示输出形式，不代表真实客户成果。",
      ],
      [
        "订阅后会进入哪里？",
        "场景会经过登录与 Stripe 结账保留。订阅验证成功后，直接导入素材、核对证据并保存重点；已有订阅可进入同一个工作区继续。",
      ],
      [
        "能保证改善业务结果吗？",
        "不能。结论需人工核对，引用是证据，不等于全量频次，也不证明业务效果。",
      ],
    ],
    final: "带上一个真实问题，让第一份报告有用起来。",
    footer: "留住你的判断，把整理工作交给 Piggybot。",
    privacy: "隐私政策",
    terms: "服务条款",
    login: "已有订阅？直接进入这条工作流",
    start: "开始试用",
    back: "官网首页",
  },
};
for (const lang of ["en", "zh", "es"]) {
  const c = shared[lang];
  for (const original of zh) {
    const d =
      lang === "zh"
        ? original
        : { ...original, ...translations[lang][original.slug] };
    const home = path(lang);
    const canonical = `https://www.piggybot.me${path(lang, d.slug)}`;
    const checkout = (plan = d.plan, placement = "hero") =>
      `${home}activate?persona=${d.slug}&plan=${plan}&placement=${placement}`;
    const logo = `<a class="brand" href="${home}"><img src="/src/assets/piggy-head.webp" alt="" width="42" height="42">piggybot<span>.me</span></a>`;
    const title = `Piggybot for ${d.en} — ${d.template}`;
    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><meta name="description" content="${e(d.desc)}" /><link rel="stylesheet" href="/src/audience/landing.css"><script type="module" src="/src/audience/landing.ts"></script><script type="application/ld+json">${JSON.stringify(
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: title,
        description: d.desc,
        url: canonical,
        inLanguage: lang,
        breadcrumb: {
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: c.back,
              item: `https://www.piggybot.me${home}`,
            },
            { "@type": "ListItem", position: 2, name: d.en, item: canonical },
          ],
        },
      },
    ).replaceAll(
      "<",
      "\\u003c",
    )}</script></head><body class="${d.color}" data-persona="${d.slug}"><a class="skip" href="#main">${c.skip}</a><header>${logo}<nav aria-label="Solutions">${zh.map((p) => `<a href="${path(lang, p.slug)}" ${p.slug === d.slug ? 'aria-current="page"' : ""}>${p.en}</a>`).join("")}</nav><a class="nav-cta" href="#plans">${c.plans} ↗</a></header><div class="landing-languages" aria-label="Language">${["en", "zh", "es"].map((l) => `<a href="${path(l, d.slug)}" ${l === lang ? 'aria-current="page"' : ""}>${{ en: "English", zh: "简体中文", es: "Español" }[l]}</a>`).join("")}</div><main id="main"><section class="hero"><div class="hero-copy"><p class="eyebrow">✧ ${e(d.tag)}</p><h1>${d.title}</h1><p class="lede">${e(d.desc)}</p><div class="actions"><a class="button primary" href="${checkout()}">${e(d.cta)} →</a><a class="text-link" href="#example">${c.example}</a></div><p class="trial">${c.trial} $${d.price}${c.mo}</p><p><a class="text-link" href="/app?locale=${lang}&persona=${d.slug}#start">${c.login} ↗</a></p><div class="hero-chips">${d.chips.map((x) => `<span>✓ ${e(x)}</span>`).join("")}</div></div><div class="hero-visual" id="example"><div class="note">${c.note}</div><div class="workspace"><div class="window-top"><span class="dots">● ● ●</span><span>PIGGYBOT / INSIGHTS</span><span class="sample">${c.sample}</span></div><div class="workspace-inner"><p class="eyebrow">${e(d.demoSub)}</p><h3>${e(d.demoTitle)}</h3><div class="tabs" role="tablist" aria-label="${c.sample}">${c.tabs.map((t, i) => `<button role="tab" aria-selected="${i === 0}" aria-controls="panel-${i}" id="tab-${i}" data-tab="${i}" tabindex="${i === 0 ? 0 : -1}">${t}</button>`).join("")}</div><div class="report-panel" id="panel-0" role="tabpanel" aria-labelledby="tab-0"><span class="pill">${c.tabs[0]}</span><h4>${e(d.finding)}</h4><div class="evidence-mini">↳ ${e(d.source)}</div><p class="muted">${c.quoteNote}</p></div><div class="report-panel" id="panel-1" role="tabpanel" aria-labelledby="tab-1" hidden><blockquote>${e(d.quote)}</blockquote><p>${e(d.source)}</p><p class="muted">${c.quoteNote}</p></div><div class="report-panel" id="panel-2" role="tabpanel" aria-labelledby="tab-2" hidden><span class="pill">${c.tabs[2]}</span><h4>${e(d.action)}</h4><p>${e(d.actionDesc)}</p></div><div class="report-bottom"><span class="status-dot"></span>${c.human}</div></div></div><div class="floating-note"><img src="/src/assets/piggy-head.webp" alt="" width="38" height="38"><span>${c.footer}</span></div></div></section><div class="journey"><span>${d.en}</span><strong>${e(d.outcome)}</strong><span>↗</span></div><section class="section pain-section"><div><p class="eyebrow">SOUND FAMILIAR?</p><h2>${c.familiar}</h2></div><div class="pain-list">${d.pains.map((p, i) => `<p><span>0${i + 1}</span>${e(p)}</p>`).join("")}</div></section><section class="section values"><p class="eyebrow">LESS SORTING. MORE CLARITY.</p><h2>${c.value}</h2><div class="cards">${d.cards.map(([tag, title, desc]) => `<article><span class="eyebrow">${e(tag)}</span><h3>${e(title)}</h3><p>${e(desc)}</p></article>`).join("")}</div></section><section class="section workflow" id="workflow"><div class="section-heading"><div><p class="eyebrow">YOUR FIRST WORKFLOW</p><h2>${c.workflow}</h2></div><p>${c.context}</p></div><div class="steps">${c.steps.map((t, i) => `<article><span class="step-number">0${i + 1}</span><h3>${t}</h3><p>${c.stepCopy[i]}</p></article>`).join("")}</div></section><section class="section pricing" id="plans"><div class="section-heading"><div><p class="eyebrow">A SMALL START, A CLEAR PLAN</p><h2>${c.priceTitle}</h2></div><p>${e(d.fit)} ${c.flexible}</p></div><div class="plans">${[
      ["creator", "Creator", 19, 400, "2,000"],
      ["growth", "Growth", 59, "2,500", "10,000"],
      ["agency", "Agency", 169, "8,000", "50,000"],
    ]
      .map(
        ([key, name, price, credits, tasks]) =>
          `<article class="plan ${key === d.plan ? "recommended" : ""}"><div class="plan-label">${key === d.plan ? "✦ " + d.en : "Piggybot"}</div><h3>${name}</h3><p class="price">$${price}<span> ${c.mo}</span></p><p class="muted">${c.after}</p><ul><li>${credits} ${c.credits}</li><li>${tasks} ${c.tasks}</li><li>${c.trialCredits}</li></ul><a class="button ${key === d.plan ? "primary" : "outline"}" href="${checkout(key, "pricing")}">${c.choose} ${name} →</a></article>`,
      )
      .join(
        "",
      )}</div><p class="pricing-note">${c.priceNote}</p></section><section class="section faq"><div><p class="eyebrow">BEFORE YOU START</p><h2>${c.faq}</h2></div><div>${c.faqItems.map(([q, a]) => `<details><summary>${q}</summary><p>${a}</p></details>`).join("")}</div></section><section class="final-cta"><div><p class="eyebrow">YOUR NEXT CHAPTER</p><h2>${c.final}</h2></div><a class="button primary" href="${checkout(d.plan, "bottom")}">${e(d.cta)} →</a></section></main><footer>${logo}<p>${c.footer}</p><div>${zh.map((p) => `<a href="${path(lang, p.slug)}">${p.en}</a>`).join("")}<a href="https://discord.gg/sJjA3Nr6Bx" target="_blank" rel="noopener noreferrer">Discord Community ↗</a><a href="${home}privacy/">${c.privacy}</a><a href="${home}terms/">${c.terms}</a></div><small>© ${new Date().getUTCFullYear()} Piggybot</small></footer><div class="mobile-cta"><span>${d.plan} · $${d.price}${c.mo}<small>${c.after}</small></span><a class="button primary" href="${checkout(d.plan, "mobile")}">${c.start} →</a></div></body></html>`;
    const folder = new URL(`${path(lang, d.slug).slice(1)}`, root);
    await mkdir(folder, { recursive: true });
    await writeFile(new URL("index.html", folder), html);
  }
}
console.log("Generated 9 audience landing pages with crawlable content.");
