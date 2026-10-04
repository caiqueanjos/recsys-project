export const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
export const symbols: Record<string, string> = {
  Electronics: '⌘',
  'Home & Kitchen': '⌂',
  'Personal Care': '✦',
  Clothing: '◈',
  Sports: '◎',
  Toys: '✳',
  Groceries: '❋',
};
