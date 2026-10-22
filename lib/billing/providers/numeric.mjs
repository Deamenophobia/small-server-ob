export const numeric = (value) => {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    String(value).trim() === '' ||
    !Number.isFinite(Number(value))
  )
    throw new Error('Billing response contains missing or invalid amounts.');
  return Number(value);
};
