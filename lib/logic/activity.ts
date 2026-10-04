export interface ActivityItem {
  id: string;
  type: "TASK" | "FOCUS" | "HABIT" | "LEVEL_UP" | "STREAK" | "ACHIEVEMENT";
  label: string;
  detail?: string;
  createdAt: string;
  xpAwarded?: number;
}
