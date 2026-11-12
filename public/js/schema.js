export const canonicalFields = [
  {
    key: "customer_id",
    label: "Customer ID",
    type: "id",
    required: true,
    aliases: ["id", "record id", "record key", "customer id", "customer ref", "account id", "crm id", "client id", "customer number", "客户编号", "客户id"],
    description: "Stable source identifier used for deduplication and future syncs."
  },
  {
    key: "full_name",
    label: "Full name",
    type: "text",
    required: false,
    aliases: ["full name", "contact name", "person name", "name", "customer name", "姓名", "联系人"],
    description: "Primary contact name."
  },
  {
    key: "email",
    label: "Work email",
    type: "email",
    required: true,
    aliases: ["work email", "email", "email address", "contact email", "business email", "邮箱", "工作邮箱"],
    description: "Primary contact email after normalization."
  },
  {
    key: "company",
    label: "Company",
    type: "text",
    required: false,
    aliases: ["company", "company name", "org", "org name", "organization", "account", "account name", "employer", "公司", "企业"],
    description: "Customer organization name."
  },
  {
    key: "phone",
    label: "Phone",
    type: "phone",
    required: false,
    aliases: ["phone", "phone number", "mobile", "telephone", "contact number", "电话", "手机号"],
    description: "Normalized contact phone number."
  },
  {
    key: "country",
    label: "Country",
    type: "text",
    required: false,
    aliases: ["country", "region", "country name", "location", "market", "国家", "地区"],
    description: "Customer billing or operating country."
  },
  {
    key: "created_at",
    label: "Created at",
    type: "date",
    required: false,
    aliases: ["created at", "signup date", "created date", "registration date", "start date", "onboarded at", "创建时间", "注册日期"],
    description: "Account or contact creation date in ISO format."
  },
  {
    key: "lifecycle_stage",
    label: "Lifecycle stage",
    type: "enum",
    required: false,
    aliases: ["lifecycle stage", "status", "account status", "stage", "customer stage", "生命周期", "状态"],
    description: "Normalized lifecycle value: lead, trial, customer, or churned."
  },
  {
    key: "owner_email",
    label: "Account owner",
    type: "email",
    required: false,
    aliases: ["account owner", "owner email", "account executive", "ae", "csm", "sales owner", "客户负责人", "销售负责人"],
    description: "Internal account owner email."
  }
];

export const requiredFields = canonicalFields.filter((field) => field.required);

export function getField(key) {
  return canonicalFields.find((field) => field.key === key);
}

export function normalizeStage(value = "") {
  const normalized = String(value).trim().toLowerCase();
  if (["active", "customer", "paying", "live", "正式客户"].includes(normalized)) return "customer";
  if (["trial", "trialing", "pilot", "试用", "试点"].includes(normalized)) return "trial";
  if (["lead", "prospect", "new", "线索", "潜在客户"].includes(normalized)) return "lead";
  if (["churned", "cancelled", "canceled", "lost", "流失"].includes(normalized)) return "churned";
  return normalized || "unknown";
}

export function maskValue(type, value) {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  if (type === "email") {
    const [local, domain] = text.split("@");
    if (!domain) return `${text.slice(0, 2)}***`;
    return `${local.slice(0, 1)}***@${domain}`;
  }
  if (type === "phone") {
    const digits = text.replace(/\D/g, "");
    return `${text.startsWith("+") ? "+" : ""}${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
  }
  return text.length > 28 ? `${text.slice(0, 25)}...` : text;
}
