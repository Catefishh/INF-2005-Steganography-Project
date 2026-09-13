import pytest
import threading
from backend.app.stego import lsb


@pytest.mark.parametrize('k', range(1, 9))
@pytest.mark.parametrize('start', [0, 7, 19])
def test_round_trip_capacity_and_preservation(k, start):
    payload = bytes([0, 1, 127, 255, 165])
    span = (len(payload) * 8 + k - 1) // k
    slots = bytearray([165] * (start + span))
    before = slots[:]
    assert lsb.required_slots(len(payload), k) == span
    assert lsb.available_bytes(len(slots), start, k) == span * k // 8
    assert lsb.fits(len(slots), start, k, len(payload))
    assert not lsb.fits(len(slots), start, k, len(payload) + 1)
    with pytest.raises(lsb.CapacityError):
        lsb.embed(slots, payload + b'x', k, start)
    assert slots == before
    lsb.embed(slots, payload, k, start)
    assert lsb.extract(slots, len(payload), k, start) == payload
    assert slots[:start] == before[:start]
    assert all(a >> k == b >> k for a, b in zip(slots, before))
    with pytest.raises(lsb.CapacityError):
        lsb.extract(slots, len(payload) + 1, k, start)


@pytest.mark.parametrize('k', range(1, 9))
def test_bit_order_padding_mask_and_empty(k):
    span = (8 + k - 1) // k
    slots = bytearray([255] * (span + 2))
    lsb.embed(slots, b'\xa5', k, 1)
    bits = [1, 0, 1, 0, 0, 1, 0, 1] + [0] * (span * k - 8)
    for j in range(span):
        assert slots[j + 1] & ((1 << k) - 1) == sum(bits[j*k+i] << i for i in range(k))
    assert slots[0] == slots[-1] == 255
    if span * k > 8:
        slots[span] |= 1 << (8 % k)
        with pytest.raises(lsb.PaddingError):
            lsb.extract(slots, 1, k, 1)
    assert lsb.occupied_slots(1, k, 1) == range(1, span + 1)
    lsb.mask_slots(slots, 1, k, 1)
    assert slots == bytearray([255] + [255 & ~((1 << k)-1)] * span + [255])
    before = slots[:]
    lsb.embed(slots, b'', k, len(slots))
    lsb.mask_slots(slots, 0, k, len(slots))
    assert lsb.extract(slots, 0, k, len(slots)) == b''


def test_lsb_cooperative_cancellation_interrupts_real_loop():
    slots = [0] * 100_000
    stopped = threading.Event()

    def check():
        stopped.set()
        raise InterruptedError

    with pytest.raises(InterruptedError):
        lsb.embed(slots, b'x' * 10_000, 1, check=check)
    assert stopped.is_set()


@pytest.mark.parametrize('bad', [-1, True, 1.5, '1', 2**64])
def test_invalid_lengths_and_indices(bad):
    for call in (
        lambda: lsb.required_slots(bad, 1),
        lambda: lsb.available_bytes(bad, 0, 1),
        lambda: lsb.available_bytes(10, bad, 1),
        lambda: lsb.occupied_slots(1, 1, bad),
        lambda: lsb.extract([0]*8, bad, 1),
    ):
        with pytest.raises(ValueError):
            call()


def test_derived_slot_spans_and_coordinate_spaces_reject_uint64_overflow():
    with pytest.raises(ValueError, match="uint64"):
        lsb.required_slots(2**64 - 1, 1)
    with pytest.raises(ValueError, match="uint64"):
        lsb.occupied_slots(1, 1, 2**64 - 1)
    with pytest.raises(ValueError, match="uint64"):
        lsb.rgb_index(2**64 - 1, 2**64 - 1, 2**64 - 2, 2**64 - 2, 2)
    with pytest.raises(ValueError, match="uint64"):
        lsb.audio_index(2**64 - 1, 2, 2**64 - 2, 1)
    with pytest.raises(ValueError, match="uint64"):
        lsb.video_index(2**64 - 1, 2, 2, 2**64 - 2, 1, 1, 2)


@pytest.mark.parametrize('k', [0, 9, True, 1.5, '2'])
def test_invalid_depth(k):
    for call in (lambda: lsb.required_slots(1,k), lambda: lsb.embed([],b'',k),
                 lambda: lsb.extract([],0,k), lambda: lsb.mask_slots([],0,k)):
        with pytest.raises(ValueError): call()


def test_invalid_slots_and_bounds_before_mutation():
    for value in (-1, 256, True, 1.5):
        slots = [255, value]
        with pytest.raises(ValueError): lsb.embed(slots,b'x',4)
        assert slots == [255, value]
        with pytest.raises(ValueError): lsb.extract(slots,1,4)
    with pytest.raises(ValueError): lsb.available_bytes(1,2,1)
    slots = [255]
    with pytest.raises(lsb.CapacityError): lsb.mask_slots(slots,1,1)
    assert slots == [255]
    with pytest.raises(ValueError): lsb.embed(slots,'x',8)


def test_keyed_suggestion():
    args = (b'k'*32, b's'*16, 'png:rgb8:雪', 3, 100, 2)
    result = lsb.suggest_start(*args)
    assert 1 <= result <= 94
    assert result == lsb.suggest_start(*args)
    assert lsb.suggest_start(*args[:4], 6, 2) == 0
    with pytest.raises(lsb.NoFitError): lsb.suggest_start(*args[:4], 5, 2)
    for pos, bad in [(0,b''),(0,'key'),(1,b''),(1,'salt'),(2,b'png'),
                     (2,''),(2,'雪'*171),(2,'\ud800')]:
        changed = list(args); changed[pos] = bad
        with pytest.raises(ValueError): lsb.suggest_start(*changed)


def test_rejection_sampling_and_span_binding(monkeypatch):
    messages = []
    class Digest:
        def __init__(self, value): self.value = value
        def digest(self): return self.value.to_bytes(32,'big')
    def fake_hmac(key, msg, algorithm):
        messages.append(msg)
        return Digest(2**256-1 if len(messages)==1 else 0)
    monkeypatch.setattr(lsb.hmac, 'new', fake_hmac)
    assert lsb.suggest_start(b'k'*32,b's'*16,'rgb',8,4,1) == 1
    assert len(messages) == 2 and messages[0] != messages[1]
    first = messages[0]
    lsb.suggest_start(b'k'*32,b's'*16,'rgb',8,5,2)
    assert messages[-1] != first


def test_coordinate_round_trips():
    for i in range(4*5*3):
        x,y,c = lsb.rgb_coordinates(i,4,5)
        assert lsb.rgb_index(4,5,x,y,c) == i == (y*4+x)*3+c
    for i in range(7*2):
        f,c = lsb.audio_coordinates(i,7,2)
        assert lsb.audio_index(7,2,f,c) == i == f*2+c
    for i in range(2*4*5*3):
        f,x,y,c = lsb.video_coordinates(i,2,4,5)
        assert lsb.video_index(2,4,5,f,x,y,c) == i == (f*4*5+y*4+x)*3+c


@pytest.mark.parametrize('bad', [-1, True, 1.5, '0', 999])
def test_invalid_coordinates(bad):
    for fn,args in [(lsb.rgb_index,[4,5,2,1,1]),(lsb.audio_index,[7,2,3,1]),
                    (lsb.video_index,[2,4,5,1,2,1,1])]:
        dimensions = 3 if fn == lsb.video_index else 2
        for pos in range(dimensions,len(args)):
            changed=args[:]; changed[pos]=bad
            with pytest.raises(ValueError): fn(*changed)
    for fn,args in [(lsb.rgb_coordinates,[0,4,5]),(lsb.audio_coordinates,[0,7,2]),
                    (lsb.video_coordinates,[0,2,4,5])]:
        args[0]=bad
        with pytest.raises(ValueError): fn(*args)


@pytest.mark.parametrize('bad', [0,-1,True,1.5,'4'])
def test_invalid_dimensions(bad):
    for fn,args,positions in [(lsb.rgb_index,[4,5,2,1,1],range(2)),
        (lsb.audio_index,[7,2,3,1],range(2)),(lsb.video_index,[2,4,5,1,2,1,1],range(3)),
        (lsb.rgb_coordinates,[0,4,5],range(1,3)),(lsb.audio_coordinates,[0,7,2],range(1,3)),
        (lsb.video_coordinates,[0,2,4,5],range(1,4))]:
        for pos in positions:
            changed=args[:]; changed[pos]=bad
            with pytest.raises(ValueError): fn(*changed)
