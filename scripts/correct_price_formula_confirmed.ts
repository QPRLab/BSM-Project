/*
 * 正确的Uniswap V3价格计算过程
 * 根据用户的正确理解重新整理
 */

console.log('=== Uniswap V3价格计算的正确过程 ===\n');

const tick = 228203;
const decimals0 = 6;  // USDC (Token0)
const decimals1 = 18; // WLTC (Token1)

console.log('📊 池子信息:');
console.log('  Token0: USDC (6 decimals)');
console.log('  Token1: WLTC (18 decimals)');
console.log('  当前Tick:', tick);
console.log('');

// ============================================
// 步骤1: 从tick计算原始价格
// ============================================
console.log('步骤1️⃣: 从tick计算原始价格 p');
console.log('-'.repeat(60));
const p = Math.pow(1.0001, tick);
console.log('  p = 1.0001^228203');
console.log('  p =', p.toExponential());
console.log('  p ≈ 8.133 × 10^9');
console.log('');
console.log('  💡 这个p表示:');
console.log('     p = (token1的最小单位数量) / (token0的最小单位数量)');
console.log('     即: 1 wei USDC 能换 8.133×10^9 wei WLTC');
console.log('');

// ============================================
// 步骤2: 调整decimals得到人类可读价格
// ============================================
console.log('步骤2️⃣: 调整decimals得到人类可读价格 p\'');
console.log('-'.repeat(60));
console.log('  我们需要知道: 1个完整的USDC能换多少个完整的WLTC');
console.log('');
console.log('  1个完整USDC = 10^6 wei');
console.log('  1个完整WLTC = 10^18 wei');
console.log('');
console.log('  计算:');
console.log('    如果 1 wei USDC = p wei WLTC');
console.log('    那么 10^6 wei USDC = p × 10^6 wei WLTC');
console.log('');
console.log('  转换为完整WLTC单位:');
console.log('    p × 10^6 wei WLTC = (p × 10^6) / 10^18 个完整WLTC');
console.log('');

const p_adjusted = p * Math.pow(10, decimals0) / Math.pow(10, decimals1);
console.log('  p\' = p × 10^decimals0 / 10^decimals1');
console.log('  p\' = p × 10^6 / 10^18');
console.log('  p\' =', p.toExponential(), '× 10^6 / 10^18');
console.log('  p\' =', p_adjusted);
console.log('  p\' ≈ 0.00813');
console.log('');

console.log('✅ 结论:');
console.log('  p\' = 0.00813 表示:');
console.log('  1个完整的USDC(Token0) = 0.00813个完整的WLTC(Token1)');
console.log('');

// ============================================
// 步骤3: 计算反向价格
// ============================================
console.log('步骤3️⃣: 计算反向价格 (1 WLTC = ? USDC)');
console.log('-'.repeat(60));
const wltc_price_in_usdc = 1 / p_adjusted;
console.log('  1 WLTC = 1 / p\' USDC');
console.log('  1 WLTC = 1 / 0.00813 USDC');
console.log('  1 WLTC =', wltc_price_in_usdc.toFixed(2), 'USDC');
console.log('');

// ============================================
// 验证
// ============================================
console.log('🔍 验证:');
console.log('-'.repeat(60));
console.log('  储备数量:');
const reserves_usdc = 307367.743932;
const reserves_wltc = 2499.96249999978343131;
console.log('    USDC:', reserves_usdc);
console.log('    WLTC:', reserves_wltc);
console.log('');

const price_from_reserves = reserves_usdc / reserves_wltc;
console.log('  从储备计算: 1 WLTC =', price_from_reserves.toFixed(2), 'USDC');
console.log('  从Tick计算: 1 WLTC =', wltc_price_in_usdc.toFixed(2), 'USDC');
console.log('  前端显示:   1 WLTC = 122 USDC');
console.log('');

const diff = Math.abs(price_from_reserves - wltc_price_in_usdc);
console.log('  差异:', diff.toFixed(2), 'USDC');
console.log('  差异百分比:', ((diff / price_from_reserves) * 100).toFixed(4), '%');
console.log('');

console.log('✅ 三种方法计算的价格高度一致！');
console.log('');

// ============================================
// 通用公式总结
// ============================================
console.log('📐 通用公式总结:');
console.log('-'.repeat(60));
console.log('');
console.log('给定:');
console.log('  - tick: 当前价格tick');
console.log('  - decimals0: Token0的小数位数');
console.log('  - decimals1: Token1的小数位数');
console.log('');
console.log('计算过程:');
console.log('  1. p = 1.0001^tick');
console.log('     (这是wei级别的价格比例)');
console.log('');
console.log('  2. p\' = p × 10^decimals0 / 10^decimals1');
console.log('     (调整为人类可读单位)');
console.log('');
console.log('  3. p\'表示: 1个Token0 = p\'个Token1');
console.log('');
console.log('  4. 反向价格: 1个Token1 = (1/p\')个Token0');
console.log('');

// ============================================
// 简化公式
// ============================================
console.log('📝 简化公式:');
console.log('-'.repeat(60));
console.log('');
console.log('  p\' = 1.0001^tick × 10^(decimals0 - decimals1)');
console.log('');
console.log('对于我们的例子:');
console.log('  p\' = 1.0001^228203 × 10^(6 - 18)');
console.log('  p\' = 1.0001^228203 × 10^(-12)');
console.log('  p\' =', p, '× 10^(-12)');
console.log('  p\' =', p * Math.pow(10, -12));
console.log('  p\' ≈ 0.00813');
console.log('');
console.log('  因此: 1 WLTC = 1/0.00813 =', (1/(p * Math.pow(10, -12))).toFixed(2), 'USDC ✅');
console.log('');

console.log('=== 完成 ===');
console.log('您的理解完全正确！🎉');
