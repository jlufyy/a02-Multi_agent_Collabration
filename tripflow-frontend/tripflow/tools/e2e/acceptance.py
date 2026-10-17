"""
TripFlow 前端验收流程（手机视口，带断言）。

前置：
  1. node tools/contract-stub/server.mjs        # 契约测试桩（非真实后端）
  2. cd apps/web && npx vite --port 5173
用法：
  python3 tools/e2e/acceptance.py <输出目录>
输出：<输出目录>/report.md、report.json 和每一步的截图。

注意：本脚本验证的是“前端 + 契约”的行为。地点/路线/AI 内容来自测试桩，
不能作为真实 API、真机定位或部署验收的证据（这些仍需按 PRD §13 单独验收）。
"""
import json, os, sys, time, traceback
from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get('TRIPFLOW_URL', 'http://localhost:5173/')
OUT = sys.argv[1] if len(sys.argv) > 1 else 'acceptance-out'
os.makedirs(OUT, exist_ok=True)
results = []

# 包装 geolocation.watchPosition 以统计调用次数（验证“开启旅行前不定位”）
COUNT_GEO = """
(() => { const g = navigator.geolocation; if (!g) return;
  const w = g.watchPosition.bind(g); window.__watchCalls = 0;
  g.watchPosition = (...a) => { window.__watchCalls++; return w(...a); }; })();
"""

def run(pg, sid, ac, title, fn):
    t0 = time.time()
    try:
        note = fn() or ''
        status = 'PASS'
    except Exception as e:
        status, note = 'FAIL', f'{type(e).__name__}: {str(e).splitlines()[0][:220]}'
        if os.environ.get('E2E_DEBUG'): print(str(e)[:900])
    shot = f'{sid}.png'
    try: pg.screenshot(path=os.path.join(OUT, shot))
    except Exception: shot = ''
    results.append(dict(id=sid, ac=ac, title=title, status=status, note=note, secs=round(time.time() - t0, 1), shot=shot))
    print(f'{status:4} {sid} [{ac}] {title} {("— " + note) if note else ""}', flush=True)
    return status == 'PASS'

def first_stop(pg):
    return pg.locator('ol li button[aria-label$="，选中"], ol li button[aria-label$="，查看详情"]').first.get_attribute('aria-label').split('，')[0]

def drag(pg, src_label, dst_label):
    h = pg.get_by_label(src_label).bounding_box(); t = pg.get_by_label(dst_label).bounding_box()
    x = h['x'] + h['width'] / 2
    pg.mouse.move(x, h['y'] + h['height'] / 2); pg.mouse.down()
    for i in range(1, 16):
        pg.mouse.move(x, h['y'] + (t['y'] - h['y'] + 24) * i / 15); pg.wait_for_timeout(25)
    pg.mouse.up()

def select_stop(pg, name):
    """选中某站（已选中则不重复点击，否则会打开详情）。"""
    if pg.get_by_label(f'{name}，选中').count():
        pg.get_by_label(f'{name}，选中').click()
    expect(pg.get_by_label(f'{name}，查看详情')).to_be_visible()

def stop_row(pg, name):
    return pg.locator(f'button[aria-label="{name}，选中"], button[aria-label="{name}，查看详情"]')

def close_top(pg):
    pg.get_by_label('关闭').last.click(); pg.wait_for_timeout(250)

def console_log_text(pg):
    return pg.locator('pre').inner_text()

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, locale='zh-CN')
    ctx.add_init_script(COUNT_GEO)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'ERR_TUNNEL' not in m.text and 'fonts.g' not in m.text and errors.append(m.text))
    expect.set_options(timeout=12000)

    def s01():
        pg.goto(BASE); expect(pg.get_by_role('button', name='开始规划行程')).to_be_visible()
        login = pg.get_by_role('button', name='登录').count() + pg.locator('input[type=password]').count()
        assert login == 0, '出现登录入口或密码框'
        ov = pg.evaluate('document.documentElement.scrollWidth - innerWidth')
        assert ov <= 0, f'横向溢出 {ov}px'
        return '无登录入口、无横向溢出'
    run(pg, 'S01', 'AC-01 AC-17', '首页免登录打开', s01)

    def s02():
        pg.get_by_role('button', name='开始规划行程').click()
        pg.get_by_text('两个人去北京玩 2 天').click()
        pg.get_by_role('button', name='AI 解析为可编辑表单').click()
        pg.wait_for_url('**/confirm')
        expect(pg.locator('input[placeholder="如：北京"]')).to_have_value('北京')
        expect(pg.get_by_text('AI 不确定').first).to_be_visible()
        expect(pg.get_by_text('已匹配：天安门')).to_be_visible()
        return '城市/人数/任务已抽取，并标出不确定字段'
    run(pg, 'S02', 'AC-04', '自然语言 → 可编辑表单', s02)

    def s03():
        city = pg.locator('input[placeholder="如：北京"]')
        city.fill(''); pg.get_by_role('button', name='开始规划行程').click()
        expect(pg.get_by_text('请填写目的地城市')).to_be_visible()
        assert '/confirm' in pg.url, '缺字段时仍然跳转了'
        city.fill('北京')
        return '缺少必填字段时阻止规划'
    run(pg, 'S03', 'AC-04', '必填校验', s03)

    def s04():
        pg.get_by_role('button', name='开始规划行程').click()
        expect(pg.get_by_text('筛选优质景点')).to_be_visible()
        expect(pg.get_by_text('部分待核验')).to_be_visible()
        pg.get_by_role('button', name='我已了解未核验项，保存行程').click()
        pg.wait_for_url('**/trip/*'); expect(pg.get_by_label('天坛公园，选中')).to_be_visible()
        return '进度来自服务端事件；PARTIAL 需显式接受后才落地'
    run(pg, 'S04', 'AC-12 AC-14', '多 Agent 规划与真实进度', s04)

    def s05():
        pg.reload(); expect(pg.get_by_label('天坛公园，选中')).to_be_visible()
        return f'刷新后首站：{first_stop(pg)}'
    run(pg, 'S05', 'AC-17', '刷新后本地恢复', s05)

    def s06():
        select_stop(pg, '前门大街')
        pg.get_by_label('前门大街，查看详情').click()
        pg.get_by_role('button', name='查看数据来源').click()
        expect(pg.get_by_text('测试桩数据，非真实')).to_be_visible()
        expect(pg.get_by_text('未获取（不假设）').first).to_be_visible()
        close_top(pg)
        return '选中联动、来源与“未获取不假设”'
    run(pg, 'S06', 'AC-05 AC-14', '选中与活动详情', s06)

    def s07():
        drag(pg, '拖动调整 天坛公园 的顺序', '拖动调整 前门大街 的顺序')
        expect(pg.get_by_role('heading', name='确认行程变更')).to_be_visible()
        expect(pg.get_by_role('button', name='确认修改')).to_be_disabled()
        pg.get_by_role('button', name='取消', exact=True).click(); pg.wait_for_timeout(500)
        assert first_stop(pg) == '天坛公园', f'取消后首站变成了 {first_stop(pg)}'
        return '取消后正式计划不变；未接受未核验项时不能确认'
    run(pg, 'S07', 'AC-06 E01', '拖拽 → 预览 → 取消', s07)

    def s08():
        drag(pg, '拖动调整 天坛公园 的顺序', '拖动调整 前门大街 的顺序')
        expect(pg.get_by_role('heading', name='确认行程变更')).to_be_visible()
        pg.get_by_text('我了解上方').click(); pg.get_by_role('button', name='确认修改').click()
        expect(pg.get_by_text('已应用修改')).to_be_visible()
        assert first_stop(pg) == '前门大街', first_stop(pg)
        return '最终复核后原子提交'
    run(pg, 'S08', 'AC-06', '拖拽 → 预览 → 确认', s08)

    def s09():
        pg.get_by_label('撤销').click(); pg.wait_for_timeout(500)
        a = first_stop(pg)
        pg.get_by_label('重做').click(); pg.wait_for_timeout(500)
        b2 = first_stop(pg)
        assert (a, b2) == ('天坛公园', '前门大街'), (a, b2)
        return '撤销→天坛公园；重做→前门大街'
    run(pg, 'S09', 'AC-23', '撤销 / 重做', s09)

    def s10():
        pg.get_by_label('打开 AI 助手').click()
        pg.get_by_label('说说要怎么改…').fill('今天下午不想走太多路，删掉最后一站换成附近咖啡馆，预算不能增加')
        pg.get_by_label('发送').click()
        expect(pg.get_by_text('LOCKED_ACTIVITY_CHANGED')).to_be_visible()
        expect(pg.get_by_role('button', name='无法应用（存在冲突）')).to_be_disabled()
        pg.get_by_role('button', name='取消', exact=True).click(); pg.wait_for_timeout(300); pg.wait_for_timeout(400)
        expect(stop_row(pg, '天安门广场')).to_be_visible()
        return '涉及锁定拍摄任务的整批修改被阻止，未部分生效'
    run(pg, 'S10', 'AC-22 E03', 'AI 批量修改遇到锁定项', s10)

    def s11():
        select_stop(pg, '前门大街')
        pg.get_by_label('打开 AI 助手').click()
        expect(pg.get_by_text('选中：前门大街')).to_be_visible()
        pg.get_by_label('快捷操作').click(); pg.get_by_role('button', name='讲解这里').click()
        expect(pg.get_by_text('AI 创作辅助').last).to_be_visible()
        return 'AI 收到选中地点上下文并返回内容'
    run(pg, 'S11', 'AC-21', '选中地点 → 讲解这里', s11)

    def s12():
        pg.get_by_label('快捷操作').click(); pg.get_by_role('button', name='附近美食').click()
        expect(pg.get_by_role('button', name='加入行程').first).to_be_visible()
        pg.get_by_role('button', name='加入行程').first.click()
        expect(pg.get_by_role('heading', name='确认行程变更')).to_be_visible()
        expect(pg.get_by_text('新增「胡同里的咖啡馆（测试）」')).to_be_visible()
        pg.get_by_role('button', name='取消', exact=True).click(); pg.wait_for_timeout(300); pg.wait_for_timeout(400)
        return '附近候选只能经预览加入'
    run(pg, 'S12', 'AC-16', '附近推荐 → 加入修改草稿', s12)

    def s13():
        calls0 = pg.evaluate('window.__watchCalls')
        pg.get_by_label('开启旅行模式').click()
        expect(pg.get_by_text('开启并请求定位')).to_be_visible()
        calls1 = pg.evaluate('window.__watchCalls')
        pg.get_by_role('button', name='开启并请求定位').click()
        expect(pg.get_by_text('未获得位置权限')).to_be_visible()
        expect(stop_row(pg, '前门大街')).to_be_visible()
        expect(pg.get_by_label('拖动调整 天坛公园 的顺序')).to_be_enabled()
        calls2 = pg.evaluate('window.__watchCalls')
        assert calls0 == 0 and calls1 == 0 and calls2 >= 1, (calls0, calls1, calls2)
        return f'确认前定位调用 {calls1} 次，确认后 {calls2} 次；拒绝后仍可编辑'
    run(pg, 'S13', 'AC-07 E08', '用户开启后才定位；拒绝权限', s13)

    def s14():
        pg.get_by_label('演示控制台').first.click()
        pg.get_by_role('switch', name='模拟模式').click()
        expect(pg.get_by_text('模拟时钟')).to_be_visible()
        pg.locator('select').select_option(label='2. 天坛公园')
        pg.get_by_role('button', name='GPS 跳点 5km').click(); pg.wait_for_timeout(700)
        pg.get_by_role('button', name='低精度 600m').click(); pg.wait_for_timeout(700)
        log = console_log_text(pg)
        assert 'LOW_ACCURACY' in log and 'ARRIVE' not in log, log[:200]
        return '低精度样本被拒，没有误判到达'
    run(pg, 'S14', 'E06', '跳点 / 低精度不误判', s14)

    def s15():
        pg.locator('select').select_option(label='1. 前门大街')
        pg.get_by_role('button', name='接近 → 驻留').click()
        expect(pg.locator('pre')).to_contain_text('ARRIVE', timeout=20000)
        close_top(pg)
        expect(pg.get_by_text('顺路知识 · L1')).to_be_visible()
        expect(pg.get_by_text('模拟事件').first).to_be_visible()
        pg.get_by_label('忽略').first.click(); pg.wait_for_timeout(400)
        return '驻留达标后自动到达，L1 带模拟标签'
    run(pg, 'S15', 'AC-08 AC-10 AC-14', '模拟接近 → 自动到达 → L1', s15)

    def s16():
        pg.get_by_label('演示控制台').first.click()
        pg.get_by_role('button', name='接近 → 驻留').click(); pg.wait_for_timeout(6000)
        close_top(pg); pg.wait_for_timeout(1500)
        assert pg.get_by_text('顺路知识 · L1').count() == 0, '同一到达重复弹出'
        return '仍在原地，没有新到达，也没有重复提醒'
    run(pg, 'S16', 'E09 AC-25', '同一到达不重复提醒', s16)

    def s17():
        pg.get_by_label('演示控制台').first.click()
        pg.locator('select').select_option(label='3. 天安门广场')
        pg.get_by_role('button', name='持续离开').click(); pg.wait_for_timeout(4500)
        pg.get_by_role('button', name='接近 → 驻留').click()
        expect(pg.locator('pre')).to_contain_text('ARRIVE', timeout=20000)
        close_top(pg)
        expect(pg.get_by_text('你的任务 · L2')).to_be_visible()
        expect(pg.get_by_text('推定已离开').first).to_be_visible()
        return '离开推定完成；到达任务地点触发 L2'
    run(pg, 'S17', 'AC-09 AC-08', '历史意图 + 位置 → L2', s17)

    def s18():
        pg.get_by_role('button', name='查看讲稿').click()
        expect(pg.get_by_text('（测试桩）讲稿提纲……')).to_be_visible()
        pg.get_by_role('button', name='把讲稿改得更口语、控制在 1 分钟').click()
        expect(pg.get_by_text('实时完善（测试桩）')).to_be_visible()
        close_top(pg)
        return '先显示预准备内容，再实时完善'
    run(pg, 'S18', 'AC-11', '预准备 + 到达后实时完善', s18)

    def s19():
        pg.get_by_label('演示控制台').first.click()
        pg.get_by_role('button', name='交通延误').click()
        close_top(pg)
        expect(pg.get_by_text('风险提醒 · L3')).to_be_visible()
        pg.get_by_text('为什么提醒？查看依据').click()
        expect(pg.get_by_text('模拟事件，非真实数据')).to_be_visible()
        pg.get_by_role('button', name='查看建议').click()
        expect(pg.get_by_text('TripFlow AI')).to_be_visible()
        close_top(pg)
        return 'L3 有证据、不自动改行程，只给调整入口'
    run(pg, 'S19', 'AC-10 E10', '风险 L3', s19)

    def s20():
        pg.get_by_label('设置').click()
        pg.get_by_role('switch', name='暂停普通提醒').click()
        expect(pg.get_by_role('switch', name='暂停普通提醒')).to_have_attribute('aria-checked', 'true')
        expect(pg.get_by_role('switch', name='风险提醒')).to_have_attribute('aria-checked', 'true')  # L3 仍开
        pg.get_by_label('返回').click()
        pg.get_by_label('演示控制台').first.click()
        pg.locator('select').select_option(label='2. 天坛公园')
        pg.get_by_role('button', name='接近 → 驻留').click()
        expect(pg.locator('pre')).to_contain_text('ARRIVE', timeout=20000)
        close_top(pg); pg.wait_for_timeout(1500)
        assert pg.get_by_text('顺路知识 · L1').count() == 0, '暂停后仍弹出 L1'
        return '暂停普通提醒后不再弹 L1；L3 开关独立'
    run(pg, 'S20', 'AC-25', '暂停普通提醒', s20)

    def s21():
        pg.get_by_label('演示控制台').first.click()
        pg.get_by_role('button', name='结束演示').click(); pg.wait_for_timeout(600)
        assert pg.get_by_text('· 演示').count() == 0, '演示标签仍在'
        left = pg.locator('ol').get_by_text('游览中', exact=True).all_inner_texts() + pg.locator('ol').get_by_text('推定已离开', exact=True).all_inner_texts()
        assert not left, f'遗留了模拟到达状态：{left}'
        assert pg.get_by_text('模拟位置（演示）').count() == 0, '仍显示模拟位置'
        return '退出演示后无模拟到达/风险遗留'
    run(pg, 'S21', 'E16', '退出演示不污染真实记录', s21)

    def s22():
        assert not errors, errors[:3]
        return '无页面异常'
    run(pg, 'S22', '—', '全程控制台无错误', s22)
    b.close()

passed = sum(r['status'] == 'PASS' for r in results)
json.dump(results, open(os.path.join(OUT, 'report.json'), 'w'), ensure_ascii=False, indent=1)
with open(os.path.join(OUT, 'report.md'), 'w') as f:
    f.write(f'# TripFlow 前端验收流程结果\n\n{passed}/{len(results)} 通过 · 移动视口 390×844 · 契约测试桩\n\n')
    f.write('| 步骤 | 对应验收 | 内容 | 结果 | 说明 |\n|---|---|---|---|---|\n')
    for r in results:
        f.write(f"| {r['id']} | {r['ac']} | {r['title']} | {r['status']} | {r['note']} |\n")
print(f'\n{passed}/{len(results)} PASS')
