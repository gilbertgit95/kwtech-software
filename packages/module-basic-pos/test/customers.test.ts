import {
  posContactAsCustomerFields,
  posCustomerContactLine,
  preparePosEmail,
  preparePosFacebookUrl,
  preparePosPhone,
} from '../src/domain/customers.js';

describe('a customer’s phone', () => {
  it('is kept as typed, and empty is none', () => {
    expect(preparePosPhone(' 0917  123 4567 ')).toEqual({ phone: '0917 123 4567' });
    expect(preparePosPhone('+63 917 123 4567 loc 2')).toEqual({ phone: '+63 917 123 4567 loc 2' });
    expect(preparePosPhone('')).toEqual({ phone: null });
  });

  it('⚠ needs a number in it, and stays short', () => {
    expect(preparePosPhone('call the shop')).toEqual({ refused: 'invalid_phone' });
    expect(preparePosPhone('9'.repeat(41))).toEqual({ refused: 'invalid_phone' });
  });
});

describe('a customer’s e-mail', () => {
  it('has something, an @, and a domain with a dot', () => {
    expect(preparePosEmail(' juan@example.com ')).toEqual({ email: 'juan@example.com' });
    expect(preparePosEmail('')).toEqual({ email: null });
    for (const text of ['juan', 'juan@', '@example.com', 'juan@example', 'juan dela@example.com']) {
      expect(preparePosEmail(text)).toEqual({ refused: 'invalid_email' });
    }
  });
});

describe('a customer’s Facebook link', () => {
  it('accepts a profile, a page or a Messenger link, typed with or without https', () => {
    expect(preparePosFacebookUrl('facebook.com/juan.delacruz')).toEqual({
      facebookUrl: 'https://facebook.com/juan.delacruz',
    });
    expect(preparePosFacebookUrl('https://www.facebook.com/profile.php?id=100012345#about')).toEqual({
      facebookUrl: 'https://www.facebook.com/profile.php?id=100012345',
    });
    expect(preparePosFacebookUrl('m.me/juan.delacruz')).toEqual({ facebookUrl: 'https://m.me/juan.delacruz' });
    expect(preparePosFacebookUrl('http://M.Facebook.com/juan')).toEqual({ facebookUrl: 'https://m.facebook.com/juan' });
    expect(preparePosFacebookUrl('  ')).toEqual({ facebookUrl: null });
  });

  it('⚠ refuses anything that is not Facebook’s own https address — it is drawn as a link staff click', () => {
    const refused = [
      'javascript:alert(1)',
      'https://evil.example/facebook.com/juan',
      'https://facebook.com.evil.example/juan',
      'https://notfacebook.com/juan',
      'https://user:pass@facebook.com/juan',
      'https://facebook.com:8443/juan',
      'ftp://facebook.com/juan',
      'facebook.com',
      'https://www.facebook.com/',
      'juan dela cruz',
      'juan.delacruz',
    ];
    for (const text of refused) expect(preparePosFacebookUrl(text)).toEqual({ refused: 'invalid_facebook' });
  });

  it('is the same link when prepared twice — what is stored passes the screen’s own check', () => {
    const once = preparePosFacebookUrl('fb.com/juan');
    expect(once).toEqual({ facebookUrl: 'https://fb.com/juan' });
    expect(preparePosFacebookUrl('https://fb.com/juan')).toEqual(once);
  });
});

describe('the order’s one contact line', () => {
  it('is the phone, else the e-mail, else the Facebook link, else none', () => {
    const all = { phone: '0917', email: 'j@x.ph', facebookUrl: 'https://m.me/j' };
    expect(posCustomerContactLine(all)).toBe('0917');
    expect(posCustomerContactLine({ ...all, phone: null })).toBe('j@x.ph');
    expect(posCustomerContactLine({ phone: null, email: null, facebookUrl: 'https://m.me/j' })).toBe('https://m.me/j');
    expect(posCustomerContactLine({ phone: null, email: null, facebookUrl: null })).toBeNull();
  });

  it('files the till’s contact line under e-mail when it has an @, otherwise phone', () => {
    expect(posContactAsCustomerFields(' juan@example.com ')).toEqual({ phone: null, email: 'juan@example.com' });
    expect(posContactAsCustomerFields('0917 123 4567')).toEqual({ phone: '0917 123 4567', email: null });
    expect(posContactAsCustomerFields('  ')).toEqual({ phone: null, email: null });
  });
});
