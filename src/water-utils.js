export function getWaterAmount(data, date) {
  return Number(data?.water?.[date] || 0);
}

export function changeWater(data, date, amount) {
  data.water = data.water || {};
  data.water[date] = Math.max(
    0,
    Number(data.water[date] || 0) + Number(amount || 0)
  );

  return data;
}
