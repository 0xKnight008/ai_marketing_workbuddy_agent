import {
  AUDIENCE_TEMPLATE,
  type Audience,
} from "../../platform/src/contracts/audience";
export { AUDIENCE_TEMPLATE };
export const audienceCopy = {
  creators: {
    en: {
      name: "Creators",
      title: "Turn audience comments into clear needs.",
      noun: "comments",
      report: "Comment insights",
      select: "Keep as a content direction",
      hint: "A quoted need is a signal, not a claim about your whole audience.",
    },
    zh: {
      name: "创作者",
      title: "把粉丝评论，变成听得懂的需求。",
      noun: "评论",
      report: "粉丝评论洞察",
      select: "保留为关注方向",
      hint: "单条需求是线索，不代表所有粉丝的共同偏好。",
    },
    es: {
      name: "Creadores",
      title: "Convierte comentarios en necesidades claras.",
      noun: "comentarios",
      report: "Análisis de comentarios",
      select: "Guardar como tema de interés",
      hint: "Una necesidad citada no representa a toda tu audiencia.",
    },
  },
  sellers: {
    en: {
      name: "Sellers",
      title: "Find the product issues worth investigating.",
      noun: "reviews",
      report: "Review attribution",
      select: "Prioritize for investigation",
      hint: "Possible causes are hypotheses to verify, not proven responsibility.",
    },
    zh: {
      name: "卖家",
      title: "从商品评价里，找到需要核实的问题。",
      noun: "评价",
      report: "商品评价归因",
      select: "列为优先核查问题",
      hint: "可能原因是待验证假设，不等于已经证实的责任归属。",
    },
    es: {
      name: "Vendedores",
      title: "Encuentra los problemas que merecen investigación.",
      noun: "reseñas",
      report: "Análisis de reseñas",
      select: "Priorizar para investigar",
      hint: "Las causas posibles son hipótesis, no responsabilidades demostradas.",
    },
  },
  "community-hosts": {
    en: {
      name: "Community hosts",
      title: "Understand the discussion. Know what needs attention.",
      noun: "discussions",
      report: "Community digest",
      select: "Mark for follow-up",
      hint: "Unanswered questions refer only to the imported discussion, not your full community history.",
    },
    zh: {
      name: "社群主",
      title: "读完一份摘要，知道群里在聊什么。",
      noun: "讨论",
      report: "社群讨论摘要",
      select: "标记为需要跟进",
      hint: "未回应问题仅依据导入片段，不代表完整社群记录。",
    },
    es: {
      name: "Comunidades",
      title: "Entiende la conversación y qué necesita atención.",
      noun: "conversaciones",
      report: "Resumen de comunidad",
      select: "Marcar para seguimiento",
      hint: "Las preguntas pendientes se refieren solo a la conversación importada.",
    },
  },
} satisfies Record<Audience, unknown>;
export const samples: Record<Audience, Record<"en" | "zh" | "es", string[]>> = {
  creators: {
    en: [
      "Could you show storage for a small rented kitchen?",
      "My counter is only one metre wide. Will this work?",
      "I cannot drill holes in a rented apartment.",
      "Where can I find the dimensions of those boxes?",
      "How do I keep it organized after daily use?",
    ],
    zh: [
      "能不能出一期适合租房小厨房的收纳方法？",
      "厨房台面只有一米，也能按这个方式收吗？",
      "我想先看不打孔的办法，租的房子不能乱改。",
      "收纳盒在哪里买的？想看看尺寸。",
      "东西整理后好看，但每天用完怎么保持？",
    ],
    es: [
      "¿Puedes mostrar ideas para una cocina pequeña de alquiler?",
      "Mi encimera mide solo un metro. ¿Funciona?",
      "No puedo taladrar en mi piso de alquiler.",
      "¿Dónde veo las medidas de las cajas?",
      "¿Cómo mantengo el orden cada día?",
    ],
  },
  sellers: {
    en: [
      "The cup is good but the gift box arrived crushed.",
      "It leaked in my bag; I could not see how far to tighten the lid.",
      "The instructions do not explain how to close the lid.",
      "The capacity was smaller than I expected from the photos.",
      "The size is convenient for my commute.",
    ],
    zh: [
      "杯子本身很好，但外盒到了已经压扁，送人不合适。",
      "放进包里有漏水，我没有看到杯盖要拧到哪里。",
      "说明书上没有写杯盖怎样才算拧紧。",
      "实际容量比想象的小，页面图片看不出来。",
      "杯子大小适合通勤，握着很方便。",
    ],
    es: [
      "El vaso está bien, pero la caja llegó aplastada.",
      "Se derramó en mi bolso; no sabía cuánto apretar la tapa.",
      "Las instrucciones no explican cómo cerrar la tapa.",
      "La capacidad era menor de lo que esperaba por las fotos.",
      "El tamaño es cómodo para ir al trabajo.",
    ],
  },
  "community-hosts": {
    en: [
      "Where is the guide for new members?",
      "Could we hold the event this weekend?",
      "Saturday evening works for me, Sunday does not.",
      "Where can I find the recording?",
      "The recording is linked at the end of the event post.",
    ],
    zh: [
      "新人教程在哪里？我翻了置顶，还是没找到入口。",
      "这周的共创活动能否安排在周末？",
      "周六晚上我可以，周日不行。",
      "直播回放在哪里能找到？",
      "回放已经补在活动帖的最后一条啦。",
    ],
    es: [
      "¿Dónde está la guía para nuevos miembros?",
      "¿Podemos hacer el evento este fin de semana?",
      "El sábado por la noche me viene bien; el domingo no.",
      "¿Dónde está la grabación?",
      "La grabación está al final del anuncio del evento.",
    ],
  },
};
