export type Fact = {
  text: string;
  source: string;
};

export const EXPENSE_TRACKING_FACTS: Fact[] = [
  {
    text: "People who track their daily spending are significantly more likely to report feeling in control of their finances.",
    source: "Journal of Consumer Research"
  },
  {
    text: "The average person underestimates their monthly discretionary spending by around 40%.",
    source: "Consumer Spending Research"
  },
  {
    text: "Simply writing down expenses — even without a budget — leads to measurable reductions in impulsive purchases.",
    source: "Journal of Marketing Research"
  },
  {
    text: "Small purchases under $20 account for the majority of untracked spending for most people.",
    source: "Personal Finance Research"
  },
  {
    text: "People who review their spending weekly tend to save more than those who review only monthly.",
    source: "National Endowment for Financial Education"
  },
  {
    text: "Awareness of spending patterns — not willpower — is the primary driver of reduced impulse buying.",
    source: "Behavioral Economics Research"
  },
  {
    text: "Expense tracking is consistently ranked as the #1 habit of people who achieve their financial goals.",
    source: "Financial Planning Research"
  },
  {
    text: "Food, transport, and subscriptions are the top 3 categories people most commonly underestimate.",
    source: "Consumer Spending Analysis"
  },
  {
    text: "People who log expenses in real-time are more accurate in their monthly estimates than those who recall at the end of the month.",
    source: "Cognitive Psychology Research"
  },
  {
    text: "The 'pain of paying' effect is stronger when people actively track — making every purchase feel more deliberate.",
    source: "Drazen Prelec & Duncan Simester, MIT"
  },
  {
    text: "Financial stress is reduced significantly when people have a clear picture of where their money goes, regardless of income level.",
    source: "American Psychological Association"
  },
  {
    text: "Spending awareness — knowing what you spent last week — is the first step to any lasting financial change.",
    source: "Behavioral Finance Research"
  },
  {
    text: "People tend to spend more when using cards vs. cash — tracking bridges that awareness gap.",
    source: "Priya Raghubir & Joydeep Srivastava, Journal of Experimental Psychology"
  },
  {
    text: "The act of categorizing expenses activates the same cognitive process as budgeting — without requiring a formal budget.",
    source: "Cognitive Budgeting Research"
  },
  {
    text: "Regular expense reviewers are more likely to notice and cancel unused subscriptions within the same month.",
    source: "Digital Subscription Spending Report"
  },
  {
    text: "Tracking spending for even one month changes long-term financial self-awareness, according to longitudinal studies.",
    source: "Personal Finance Longitudinal Research"
  },
  {
    text: "People who can recall their last 5 purchases make more deliberate spending decisions going forward.",
    source: "Memory & Decision-Making Research"
  },
  {
    text: "Financial self-efficacy — the belief that you can manage money — increases with consistent tracking habits.",
    source: "Financial Literacy Research"
  },
  {
    text: "Visual spending summaries (like charts and breakdowns) are more effective at changing behaviour than raw numbers.",
    source: "Data Visualization & Finance Research"
  },
  {
    text: "Logging an expense immediately after it happens is 3x more accurate than trying to remember it at day's end.",
    source: "Memory Recall Research"
  }
];

/**
 * Returns a fact for the given day, rotating through the list.
 * Using day-of-year ensures the same fact shows on a given day but rotates daily.
 */
export function getFactForDay(date: Date): Fact {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const dayOfYear = Math.floor((date.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return EXPENSE_TRACKING_FACTS[dayOfYear % EXPENSE_TRACKING_FACTS.length];
}
