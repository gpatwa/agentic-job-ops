import type { AppSession } from "../models/domain";

const now = new Date().toISOString();

export const currentSession: AppSession = {
  tenant: {
    id: "tenant_local_demo",
    name: "Local demo workspace",
    type: "individual",
    plan: "free",
    status: "active",
    createdAt: now
  },
  userId: "user_local_demo"
};
