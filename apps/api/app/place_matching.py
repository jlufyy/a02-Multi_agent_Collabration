"""Conservative matching of user names to real provider POIs, shared by A1/A2."""
import re
import unicodedata


def canonical_name(value, city=""):
    def compact(text):
        return ''.join(c for c in unicodedata.normalize('NFKC', text).casefold()
                       if c.isalnum())
    name = compact(value)
    prefix = compact(city).removesuffix('市')
    if prefix and name.startswith(prefix):
        name = name[len(prefix):].removeprefix('市')
    return name


def unique_place(query, places, city=""):
    # Punctuation/city prefixes do not change identity. Campus/branch/gate words do.
    q = canonical_name(query, city)
    pool = {p['poiId']: p for p in places}
    exact = [p for p in pool.values() if canonical_name(p['name'], city) == q]
    if exact:
        return exact[0] if len(exact) == 1 else None
    def matches(p):
        name = canonical_name(p['name'], city)
        address = canonical_name(p.get('address', ''), city)
        # A fully supplied address/venue qualifier, e.g. 龙翔国际商务中心大金球.
        if len(name) >= 3 and len(address) >= 4 and q in (address + name, name + address):
            return True
        # Common park shorthand; never discard gate/stop/parking suffixes.
        short = re.sub(r'(?:国家)?(?:湿地|森林|生态|城市|郊野|体育)公园$', '公园', name)
        return q.endswith('公园') and short == q
    matched = [p for p in pool.values() if matches(p)]
    return matched[0] if len(matched) == 1 else None


def requirement_references(req):
    for key in ('mustVisit', 'avoidPlaces'):
        for i, ref in enumerate(req[key]):
            yield f'{key}.{i}', ref, 'place'
    for key in ('startPoint', 'endPoint'):
        if req.get(key):
            yield key, req[key], 'place'
    for i, fixed in enumerate(req['fixedConstraints']):
        if fixed.get('place'):
            yield f'fixedConstraints.{i}.place', fixed['place'], 'place'
    for i, intent in enumerate(req['intents']):
        if intent['status'] != 'CANCELLED':
            yield f'intents.{i}', intent, 'placeId'
