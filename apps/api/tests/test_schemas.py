"""SYNTHETIC contract tests; no real-data/provider/device claims."""
import copy
import json
from pathlib import Path

import pytest
from pydantic import TypeAdapter, ValidationError
from app import schemas as s

ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture
def trip():
    return json.loads((ROOT/'fixtures'/'synthetic-北京-2d.json').read_text(encoding='utf-8'))['tripState']


def request(trip):
    return dict(executionMode='REAL', tripId=trip['tripId'], baseRevision=trip['revision'], tripState=trip)


@pytest.mark.parametrize('city',['北京','上海'])
@pytest.mark.parametrize('days',[1,2,3])
def test_synthetic_trip_fixtures(city,days):
    fixture=json.loads((ROOT/'fixtures'/f'synthetic-{city}-{days}d.json').read_text(encoding='utf-8'))
    assert fixture['metadata']['sourceKind']=='SYNTHETIC'
    parsed=s.TripState.model_validate(fixture['tripState'])
    assert len(parsed.activities)==days
    assert parsed.model_dump(by_alias=True,exclude_none=True)==fixture['tripState']


def test_unknown_version_extra_and_snake_names(trip):
    for changes in ({'schemaVersion':2},{'revision':-1},{'base_revision':0},{'revision':True}):
        with pytest.raises(ValidationError): s.TripState.model_validate({**trip,**changes})


def test_top_level_projection_consistency(trip):
    for field,value in [('destinationCity','广州'),('budgetCny',500),('intents',[{}])]:
        with pytest.raises(ValidationError): s.TripState.model_validate({**trip,field:value})


def test_timestamp_and_clock_strict():
    for ts in ['2026-10-20T10:00:00','2026-10-20','2026-10-20T25:00:00+08:00']:
        with pytest.raises(ValidationError): s.Evidence(provider='SYNTHETIC',status='UNKNOWN',fetchedAt=ts)
    assert s.Evidence(provider='SYNTHETIC',status='UNKNOWN',fetchedAt='2026-10-20T02:00:00Z')
    with pytest.raises(ValidationError): TypeAdapter(s.Clock).validate_python('24:00')


def test_activity_time_offset_and_day(trip):
    activity=copy.deepcopy(trip['activities'][0])
    activity['startAt']='2026-10-20T02:00:00Z'
    with pytest.raises(ValidationError): s.ItineraryActivity.model_validate(activity)
    trip['activities'][0]['dayIndex']=1
    with pytest.raises(ValidationError): s.TripState.model_validate(trip)


def test_unknown_numeric_values_and_route_geometry():
    with pytest.raises(ValidationError): s.Fact[float](value=0,evidence={'provider':'SYNTHETIC','status':'UNKNOWN'})
    with pytest.raises(ValidationError): s.TravelSegment(fromActivityId='a',toActivityId='b',mode='WALK',durationMin=0,evidence={'provider':'SYNTHETIC','status':'FAILED'})


def test_generate_requires_confirmed_and_initial_revision(trip):
    body=dict(executionMode='REAL',tripId=trip['tripId'],baseRevision=0,mode='PLANNING',requirements=trip['requirements'])
    assert s.GeneratePlanRequest.model_validate(body)
    with pytest.raises(ValidationError): s.GeneratePlanRequest.model_validate({**body,'baseRevision':1})
    body['requirements']['confirmed']=False
    with pytest.raises(ValidationError): s.GeneratePlanRequest.model_validate(body)


def test_trip_span(trip):
    req=trip['requirements']
    req['endDate']='2026-10-23'
    with pytest.raises(ValidationError): s.TripRequirements.model_validate(req)


@pytest.mark.parametrize('mode,run,valid',[('REAL',None,True),('REAL','run',False),('DEMO',None,False),('DEMO','run',True)])
def test_execution_isolation(mode,run,valid):
    data={'executionMode':mode,**({'demoRunId':run} if run else {})}
    if valid: assert s.ExecutionContext.model_validate(data)
    else:
        with pytest.raises(ValidationError): s.ExecutionContext.model_validate(data)


def test_propose_xor_and_stale_context(trip):
    body={**request(trip),'userRequest':'讲解这里'}
    assert s.ProposeRevisionRequest.model_validate(body)
    for changes in ({'operations':[{'type':'REMOVE','activityId':'syn-activity-0'}]}, {'userRequest':None}, {'baseRevision':1}):
        with pytest.raises(ValidationError): s.ProposeRevisionRequest.model_validate({**body,**changes})
    body['selectedContext']=dict(tripId=trip['tripId'],planRevision=0,mode='PLANNING',activeDay=0,selectedActivityId='missing')
    with pytest.raises(ValidationError): s.ProposeRevisionRequest.model_validate(body)


def test_refine_context_inherits_trip_validation(trip):
    body={**request(trip),'userRequest':'讲解这里','context':dict(tripId=trip['tripId'],planRevision=0,mode='PLANNING',activeDay=0)}
    assert s.RefineContentRequest.model_validate(body)
    body['context']['mode']='TRAVELING'
    with pytest.raises(ValidationError): s.RefineContentRequest.model_validate(body)


def test_discriminated_edit_and_constraint_whitelist(trip):
    adapter=TypeAdapter(s.EditOperation)
    op=adapter.validate_python(dict(type='UPDATE_CONSTRAINT',key='budgetCny',value=120))
    assert op.key=='budgetCny'
    assert op.model_dump()=={'type':'UPDATE_CONSTRAINT','key':'budgetCny','value':120}
    for data in [dict(type='UPDATE_CONSTRAINT',key='activity.id',value='x'),dict(type='UPDATE_CONSTRAINT',key='budgetCny',value='bad'),
                 dict(type='MOVE_ACTIVITY',activityId='a'),dict(type='UPDATE_DURATION',activityId='a',durationMin=0),
                 dict(type='REPLACE',activityId='a',candidatePlaceId='wrong',candidatePlace=trip['activities'][0]['place'])]:
        with pytest.raises(ValidationError): adapter.validate_python(data)


def test_candidate_revision_and_validation_projection(trip):
    validation=dict(status='PARTIALLY_VERIFIED',hardViolations=[],unknownChecks=['SYNTHETIC facts unknown'],warnings=[],committable=False)
    proposal=dict(proposalId='p',tripId=trip['tripId'],baseRevision=0,operations=[],candidate=trip,hardViolations=[],unknownChecks=validation['unknownChecks'],
                  diff=dict(added=[],removed=[],moved=[]),estimatedChanges={},validation=validation,activityChanges=[])
    assert s.RevisionProposal.model_validate(proposal)
    with pytest.raises(ValidationError): s.RevisionProposal.model_validate({**proposal,'baseRevision':1})
    with pytest.raises(ValidationError): s.RevisionProposal.model_validate({**proposal,'unknownChecks':[]})


def test_proactive_demo_and_risk_evidence(trip):
    event=dict(eventId='e',tripId=trip['tripId'],revision=0,source='SIMULATED',demoRunId='run',type='ARRIVE',activityId='syn-activity-0',arrivalId='arrival',occurredAt='2026-10-20T10:00:00+08:00')
    body={**request(trip),'currentEvent':event,'recentNotifications':[],'uiBusy':False}
    with pytest.raises(ValidationError): s.EvaluateProactiveRequest.model_validate(body)
    assert s.EvaluateProactiveRequest.model_validate({**body,'executionMode':'DEMO','demoRunId':'run'})
    with pytest.raises(ValidationError): s.ProactiveEvent.model_validate({**event,'type':'RISK'})
    with pytest.raises(ValidationError): s.ProactiveEvent.model_validate({**event,'type':'RISK','risk':dict(code='x',message='x',activityIds=[],evidence=[])})


def test_suppressed_decision_requires_reason():
    data=dict(decisionId='d',eventId='e',tripId='t',baseRevision=0,shouldNotify=False,reasonCode='SUPPRESSED')
    with pytest.raises(ValidationError): s.ProactiveDecision.model_validate(data)
    assert s.ProactiveDecision.model_validate({**data,'suppressionReason':'PAUSED'})


def test_invalid_fixture_catalog():
    fixture=json.loads((ROOT/'fixtures'/'synthetic-invalid.json').read_text(encoding='utf-8'))
    for case in fixture['cases']:
        with pytest.raises(ValidationError): TypeAdapter(getattr(s,case['schema'])).validate_python(case['input'])


def test_single_policy_file():
    policy=json.loads((ROOT/'packages'/'context-engine'/'geo-policy.json').read_text(encoding='utf-8'))
    assert s.GeoPolicy.model_validate(policy).policyVersion=='geo-m0-2026-10-16'


def test_boolean_types_are_not_coerced():
    with pytest.raises(ValidationError):
        s.NotificationPolicy(enableL1='false',enableL2=True,enableL3=True,paused=False,cooldownMinutes=15)


def test_demo_user_correction_stays_in_demo_namespace():
    correction=s.EventLogEntry(logId='correction',tripId='t',tripRevision=1,source='USER_CORRECTION',demoRunId='run',
                              occurredAt='2026-10-20T10:00:00+08:00',correction=dict(activityId='a',previous='ARRIVED',next='NOT_STARTED',reason='用户纠错'))
    assert correction.demoRunId=='run'


def test_json_schema_fixture_parity(trip):
    jsonschema=pytest.importorskip('jsonschema')
    schema=json.loads((ROOT/'packages'/'contracts'/'generated'/'schema.json').read_text(encoding='utf-8'))
    jsonschema.Draft202012Validator({**schema,'$ref':'#/$defs/TripState'}).validate(trip)
