import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SectionTitle } from "../components/SectionTitle";
import { Reveal } from "../components/Reveal";
import { SpritePuff } from "../components/ghibli/Piggy";

const FAQS = [
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
];

export function Faq() {
  return (
    <section id="faq" className="relative py-20 sm:py-28 bg-paper paper-grain overflow-hidden">
      <SpritePuff className="anim-floaty-slow absolute top-24 right-[5%] w-10 opacity-70 hidden lg:block" />
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionTitle
          badge="问答树洞"
          title={
            <>
              把疑问<span className="text-meadow-deep">丢进树洞</span>，精灵来答
            </>
          }
        />
        <Reveal delay={0.12} className="mt-12">
          <Accordion type="single" collapsible className="space-y-4">
            {FAQS.map((f, i) => (
              <AccordionItem
                key={i}
                value={`q${i}`}
                className={`bg-paper-card sketch shadow-paint px-5 sm:px-6 border-none ${i % 2 === 0 ? "wobble" : "wobble-2"}`}
              >
                <AccordionTrigger className="font-display text-base sm:text-lg text-ink hover:no-underline py-5 text-left">
                  {f.q}
                </AccordionTrigger>
                <AccordionContent className="text-[15px] leading-relaxed text-ink-soft pb-5">
                  {f.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </section>
  );
}
