// 验证命令判定的共享真源：前端工具链 + MATLAB/Simulink + C/C++ + 项目自定义规则。
// 运行：node --experimental-strip-types scripts/test-verification.ts

import { BUILTIN_VERIFICATION, isVerificationCommand, verificationMatchSource } from '../src/shared/verification.ts'

let failed = 0
const ok = (cond: boolean, msg: string): void => {
  console.log((cond ? '✓' : '✗') + ' ' + msg)
  if (!cond) failed++
}
const yes = (cmd: string, msg: string, rules?: Parameters<typeof isVerificationCommand>[1], project?: string): void =>
  ok(isVerificationCommand(cmd, rules, project), msg)
const no = (cmd: string, msg: string, rules?: Parameters<typeof isVerificationCommand>[1], project?: string): void =>
  ok(!isVerificationCommand(cmd, rules, project), msg)

// 前端 / 后端常规
yes('npm test', 'npm test')
yes('npm run build', 'npm run build')
yes('npm run audit:acceptance', '自家 audit 命令也算验证（此前三份正则漂移过）')
yes('pnpm lint', 'pnpm lint')
yes('cd app && npx vitest run', '段首 npx vitest')
yes('pytest -q', 'pytest')
yes('go test ./...', 'go test')
yes('cargo clippy', 'cargo clippy')
yes('mvn -q verify', 'mvn verify')

// MATLAB / Simulink
yes('matlab -batch "runtests(\'tests\')"', 'matlab -batch 跑测试')
yes('matlab -nodisplay -r "sim(\'model\')"', 'matlab -r 跑仿真')
yes('runtests("tests/")', 'runtests 直接调用')
yes('sltest.testmanager.run', 'Simulink Test')
yes('slcoverage -model demo', '模型覆盖率')
yes('polyspace-bug-finder -batch project', 'Polyspace 静态检查')
yes('checkcode("src")', 'MATLAB 代码检查')

// C / C++
yes('cmake --build build', 'cmake --build')
yes('cd build && make -j8', '段首 make')
yes('ctest --output-on-failure', 'ctest')
yes('gcc -c a.c -o a.o', 'gcc 编译')
yes('clang-tidy src/a.cpp', 'clang-tidy')
yes('cppcheck --enable=all src', 'cppcheck')
yes('valgrind ./a.out', 'valgrind')

// 总线 / 诊断工具
yes('CANoe64.exe -c cfg.ini', 'CANoe 回归')

// 不该误判
no('ls -la', 'ls 不算')
no('git status', 'git status 不算')
no('git commit -m "make it work"', '提交信息里的 make 不算')
no('echo "eslint is great"', '引号里的 eslint 不算')
no('cat src/main.ts', '读文件不算')

// 用户自定义：全局
const globalRules = { extra: ['run_regression'] }
yes('python run_regression.py', '全局自定义规则命中', globalRules)
yes('RUN_REGRESSION.bat', '自定义规则大小写不敏感', globalRules)
no('python other.py', '自定义规则不放宽其它命令', globalRules)

// 用户自定义：按项目
const projectRules = { byProject: { TMS_SenCorr: ['sim_suite'] } }
yes('sim_suite --all', '项目规则命中', projectRules, 'TMS_SenCorr')
no('sim_suite --all', '项目规则不串到别的项目', projectRules, 'OtherProj')

// 命中来源（设置页预览用）
ok(verificationMatchSource('npm test') === 'builtin', '内置命中来源')
ok(verificationMatchSource('run_regression', globalRules) === 'global', '全局规则来源')
ok(verificationMatchSource('sim_suite', projectRules, 'TMS_SenCorr') === 'project', '项目规则来源')
ok(verificationMatchSource('ls -la') === null, '未命中返回 null')
ok(BUILTIN_VERIFICATION.length >= 10 && BUILTIN_VERIFICATION.every((re) => re instanceof RegExp), '内置规则表可用')

if (failed > 0) {
  console.error(`\n${failed} 项失败`)
  process.exit(1)
}
console.log('\n验证命令判定全部通过')
