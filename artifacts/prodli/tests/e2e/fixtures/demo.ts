// Greets a user — used to test syntax highlighting.
export function greet(name: string, times = 2): string {
  const msg = `Hello, ${name}!`;
  return Array.from({ length: times }, () => msg).join(" ");
}
