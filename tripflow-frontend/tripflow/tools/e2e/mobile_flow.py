import os, sys, time
# 移动视口端到端流程：需先启动 tools/contract-stub/server.mjs 与 vite dev。
# 用法：python3 tools/e2e/mobile_flow.py <截图输出目录>
BASE = os.environ.get('TRIPFLOW_URL', 'http://localhost:5173/')
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]
errs = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, locale='zh-CN')
    pg = ctx.new_page()
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
    def shot(n): pg.screenshot(path=f'{OUT}/{n}.png')
    pg.goto(BASE); pg.wait_for_timeout(1500); shot('01_home')
    pg.get_by_text('新建旅行').first.click(); pg.wait_for_timeout(500)
    pg.get_by_text('两个人去北京玩 2 天').click(); shot('02_input')
    pg.get_by_role('button', name='AI 解析为可编辑表单').click()
    pg.wait_for_url('**/confirm', timeout=15000); pg.wait_for_timeout(500); shot('03_confirm')
    pg.mouse.wheel(0, 2400); pg.wait_for_timeout(300); shot('03b_confirm_scrolled')
    pg.get_by_role('button', name='确认并开始规划').click()
    pg.wait_for_timeout(900); shot('04_planning')
    pg.get_by_role('button', name='我已了解未核验项，保存行程').click(timeout=15000)
    pg.wait_for_url('**/trip/*', timeout=10000); pg.wait_for_timeout(1500); shot('05_trip')
    # 拖拽第一张卡片手柄到第三张
    h = pg.get_by_label('拖动调整 天坛公园 的顺序')
    tgt = pg.get_by_label('拖动调整 前门大街 的顺序')
    hb = h.bounding_box(); tb = tgt.bounding_box()
    pg.mouse.move(hb['x']+hb['width']/2, hb['y']+hb['height']/2); pg.mouse.down()
    for i in range(1, 15):
        pg.mouse.move(hb['x']+hb['width']/2, hb['y'] + (tb['y']-hb['y']+20)*i/14); pg.wait_for_timeout(30)
    shot('06_dragging'); pg.mouse.up(); pg.wait_for_timeout(2600); shot('07_preview')
    pg.get_by_text('我了解上方').click(); pg.get_by_role('button', name='确认应用').click(); pg.wait_for_timeout(2600); shot('08_after_commit')
    pg.get_by_label('撤销').click(); pg.wait_for_timeout(600); shot('09_undo')
    pg.get_by_label('重做').click(); pg.wait_for_timeout(600)
    # 选中 + 详情
    pg.get_by_label('前门大街，选中').click(); pg.wait_for_timeout(300); pg.get_by_label('前门大街，查看详情').click(); pg.wait_for_timeout(500); shot('10_detail')
    pg.get_by_label('关闭').first.click(); pg.wait_for_timeout(300)
    # AI 批量修改
    pg.get_by_label('打开 AI 助手').click(); pg.wait_for_timeout(400); shot('11_ai')
    pg.get_by_placeholder('说说要怎么改…').fill('明天下午不想走太多路，删掉景山，换成附近咖啡馆，预算不能增加，天安门拍摄任务不许动')
    pg.get_by_label('发送').click(); pg.wait_for_timeout(2800); shot('12_ai_preview')
    pg.get_by_role('button', name='取消').first.click(); pg.wait_for_timeout(500)
    # 旅行模式 + 演示
    ctx.grant_permissions(['geolocation']); ctx.set_geolocation({'latitude': 39.95, 'longitude': 116.3})
    pg.get_by_label('开启旅行模式').click(); pg.wait_for_timeout(300); shot('13_travel_ask')
    pg.get_by_role('button', name='开启并请求定位').click(); pg.wait_for_timeout(1500); shot('14_traveling')
    pg.get_by_label('演示控制台').click(); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='开始演示运行').click(); pg.wait_for_timeout(800)
    pg.get_by_role('button', name='接近 → 驻留').click(); pg.wait_for_timeout(5500); shot('15_demo_console')
    pg.get_by_label('关闭').first.click(); pg.wait_for_timeout(1500); shot('16_L1')
    pg.get_by_role('button', name='查看内容').click(); pg.wait_for_timeout(700); shot('17_content')
    pg.get_by_label('关闭').first.click(); pg.wait_for_timeout(300)
    pg.get_by_label('演示控制台').click(); pg.wait_for_timeout(300)
    pg.locator('select').first.select_option(index=2)
    pg.get_by_role('button', name='持续离开').click(); pg.wait_for_timeout(4500)
    pg.get_by_role('button', name='接近 → 驻留').click(); pg.wait_for_timeout(5500)
    pg.get_by_label('关闭').first.click(); pg.wait_for_timeout(1500); shot('18_L2')
    pg.get_by_role('button', name='忽略').last.click(); pg.wait_for_timeout(300)
    pg.get_by_label('演示控制台').click(); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='注入时间冲突风险').click(); pg.wait_for_timeout(300)
    pg.get_by_label('关闭').first.click(); pg.wait_for_timeout(2000); shot('19_L3')
    pg.goto(pg.url.replace('#/trip/', '#/trip/').split('?')[0]); 
    pg.get_by_label('设置').click(); pg.wait_for_timeout(500); shot('20_settings')
    b.close()
print('ERRORS:', errs)
