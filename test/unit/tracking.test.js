const url = require('url');
const nock = require('nock');
const crypto = require('crypto');
const statsd = require('../../lib/config/statsd');

const {
  submitProto,
  isDisabled,
  setIsDisabled,
  BaseURL,
} = require('../../lib/tracking');

const { Action, ActionType } = require('../../lib/proto/v0/action');

const parsedURL = url.parse(BaseURL);
const basePath = parsedURL.href.replace(parsedURL.path, '');
const origDisabledState = isDisabled();

beforeAll(() => {
  setIsDisabled(false);
});

afterAll(() => {
  setIsDisabled(origDisabledState);
});

beforeEach(() => {
  statsd.mockBuffer = [];
});

describe('Hydro Gateway Protobuf Submissions', () => {
  test.each([
    [200, true, 'OK'],
    [400, false, 'clientID Missing'],
    [404, false, 'Unknown schema'],
    [422, false, 'Invalid Payload'],
  ])('Protobuf submission status=%i expected=%p', async (status, expected, errMsg) => {
    const e = new Action();
    e.type = ActionType.CREATED;
    nock(basePath)
      .post(parsedURL.path)
      .reply(status, function (uri, requestBody) {
        expect(this.req.headers['x-hydro-app']).toBe('jira-integration');
        const hmac = crypto.createHmac('sha256', process.env.HYDRO_APP_SECRET);
        hmac.update(JSON.stringify(requestBody));
        expect(this.req.headers.authorization).toBe(`Hydro ${hmac.digest('hex')}`);
        return errMsg;
      });
    expect(await submitProto(e)).toBe(expected);
    // There will be a .dist.post and a .submission metric
    expect(statsd.mockBuffer.length).toBe(2);
  });

  test('Multiple protobuf submission', async () => {
    const protos = [
      new Action(),
      new Action(),
      new Action(),
    ];
    protos.forEach((proto) => {
      proto.type = ActionType.CREATED;
    });
    nock(basePath)
      .post(parsedURL.path)
      .reply(200, function (uri, requestBody) {
        expect(this.req.headers['x-hydro-app']).toBe('jira-integration');
        const hmac = crypto.createHmac('sha256', process.env.HYDRO_APP_SECRET);
        hmac.update(JSON.stringify(requestBody));
        expect(this.req.headers.authorization).toBe(`Hydro ${hmac.digest('hex')}`);
        return 'OK';
      });
    expect(await submitProto(protos)).toBe(true);
    // There will be a .dist.post and a .submission metric
    expect(statsd.mockBuffer.length).toBe(2);
    expect(statsd.mockBuffer[1]).toBe('jira-integration.hydro.submission:3|c|#env:test,schema:jira.v0.Action,status:200');
  });

  /**
   * This would fail if we didn't have the right secret in place
   */
  test('Returns true when disabled', async () => {
    setIsDisabled(true);
    const e = new Action();
    e.type = ActionType.CREATED;
    expect(await submitProto(e)).toBe(true);
    expect(statsd.mockBuffer.length).toBe(0);
  });
});
