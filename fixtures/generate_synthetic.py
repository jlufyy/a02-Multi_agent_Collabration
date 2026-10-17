"""Deterministic synthetic examples. Never substitute for real provider evidence."""
import copy
import json
from datetime import date, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent
META = {'sourceKind': 'SYNTHETIC', 'generatedAt': '2026-10-16T12:00:00+08:00',
        'verifiedAt': None, 'note': '人工构造契约及规则测试输入。地点和轨迹不证明真实 API、POI 或设备验证成功。'}
UNKNOWN = {'provider': 'SYNTHETIC', 'status': 'UNKNOWN', 'fetchedAt': '2026-10-16T12:00:00+08:00', 'note': 'Synthetic fixture; not verified'}


def build(city='北京', days=2, count=2):
    start = date(2026, 10, 20)
    end = start + timedelta(days=days-1)
    req = dict(requirementsId=f'syn-req-{city}-{days}', version=1, confirmed=True, destinationCity=city,
               startDate=str(start), endDate=str(end), timezone='Asia/Shanghai', travelerCount=count,
               budgetCny=1000, budgetScope='TOTAL', budgetIsHardLimit=True, includesAccommodation=False,
               includesIntercityTransport=False, transportModes=['WALK'], mustVisit=[], avoidPlaces=[], preferences=['SYNTHETIC:公园'],
               companions=[dict(id='syn-traveler-1', label='同行者', interests=['摄影'], walkingTolerance='LOW', specialNeeds=[])],
               specialNeeds=[], dailyStartTime='09:00', dailyEndTime='18:00', fixedConstraints=[], intents=[])
    activities=[]
    for d in range(days):
        day=str(start+timedelta(days=d)); aid=f'syn-activity-{d}'
        place=dict(poiId=f'syn-poi-{city}-{d}', name=f'SYNTHETIC {city}测试地点{d+1}',
                   location=dict(lat=39.9 if city=='北京' else 31.2, lng=116.4 if city=='北京' else 121.4, coordinateSystem='WGS84'),
                   evidence=[copy.deepcopy(UNKNOWN)], openingHours=dict(evidence=copy.deepcopy(UNKNOWN)), ticketPriceCny=dict(evidence=copy.deepcopy(UNKNOWN)))
        activities.append(dict(id=aid, place=place, dayIndex=d, orderIndex=0,startAt=f'{day}T10:00:00+08:00',endAt=f'{day}T11:00:00+08:00',
                               costStatus='UNKNOWN',locked=False,mandatory=False,progress='NOT_STARTED',intentIds=[]))
    trip=dict(schemaVersion=1,tripId=f'syn-trip-{city}-{days}',revision=0,title=f'SYNTHETIC {city}{days}日',destinationCity=city,
              startDate=str(start),endDate=str(end),travelerCount=count,budgetCny=1000,budgetScope='TOTAL',companions=copy.deepcopy(req['companions']),
              preferences=copy.deepcopy(req['preferences']),mode='PLANNING',lifecycle='PLAN_READY',requirements=req,activities=activities,segments=[],boundarySegments=[],intents=[],
              notificationPolicy=dict(enableL1=True,enableL2=True,enableL3=True,paused=False,cooldownMinutes=15),updatedAt='2026-10-16T12:00:00+08:00')
    return trip


def main():
    for city in ('北京','上海'):
        for days in (1,2,3):
            trip=build(city,days)
            (OUT/f'synthetic-{city}-{days}d.json').write_text(json.dumps({'metadata':META,'tripState':trip},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    trip=build()
    traces=[]
    for i,second in enumerate((0,45,90,135,180)):
        traces.append(dict(sampleId=f'syn-sample-{i}',tripId=trip['tripId'],source='SIMULATED',demoRunId='syn-demo-run-1',
                           location=trip['activities'][0]['place']['location'],accuracyMeters=10,timestamp=f'2026-10-20T10:{second//60:02d}:{second%60:02d}+08:00',pageVisible=True))
    (OUT/'synthetic-location-dwell.json').write_text(json.dumps({'metadata':META,'samples':traces},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    failures=[{'name':'REAL rejects demoRunId','schema':'ExecutionContext','input':{'executionMode':'REAL','demoRunId':'syn-demo'},'expectedError':'demoRunId'},
              {'name':'DEMO requires run','schema':'ExecutionContext','input':{'executionMode':'DEMO'},'expectedError':'demoRunId'},
              {'name':'Bad replacement id','schema':'EditOperation','input':{'type':'REPLACE','activityId':'a','candidatePlaceId':'other','candidatePlace':trip['activities'][0]['place']},'expectedError':'candidatePlaceId'},
              {'name':'Unsafe commit','schema':'ValidationReport','input':{'status':'INFEASIBLE','hardViolations':[],'unknownChecks':[],'warnings':[],'committable':True},'expectedError':'committed'},
              {'name':'Unaware timestamp','schema':'Evidence','input':{'provider':'SYNTHETIC','status':'UNKNOWN','fetchedAt':'2026-10-16T12:00:00'},'expectedError':'timezone'}]
    (OUT/'synthetic-invalid.json').write_text(json.dumps({'metadata':META,'cases':failures},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    main()
