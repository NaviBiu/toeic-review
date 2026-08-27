export function normalizeTerm(term: string): string {
  return term.toLowerCase().replace(/[\s\-']/g, '').replace(/[，,。.;；:：、]+$/g, '');
}
