# ts-wcwidth [![npm](https://img.shields.io/npm/v/ts-wcwidth.svg)](https://www.npmjs.com/package/ts-wcwidth) [![CircleCI](https://circleci.com/gh/scttcper/ts-wcwidth.svg?style=svg)](https://circleci.com/gh/scttcper/ts-wcwidth) [![coverage status](https://codecov.io/gh/scttcper/ts-wcwidth/branch/master/graph/badge.svg)](https://codecov.io/gh/scttcper/ts-wcwidth)

> Determine number of columns needed for a fixed-size wide-character string

This project is a zero dependency typescript version of [wcwidth by timoxley](https://github.com/timoxley/wcwidth) which is a port from [wcwidth.js by Jun Woong](https://github.com/mycoboco/wcwidth.js) which was from the [original version in C](https://www.cl.cam.ac.uk/~mgk25/ucs/wcwidth.c).

__Demo__: https://ts-wcwidth.netlify.com/  

## Install

```sh
npm install ts-wcwidth
```

## Usage

```ts
import wcwidth from 'ts-wcwidth';
'한'.length; // 1
wcwidth('한'); // 2

'한글'.length; // 2
wcwidth('한글'); // 4
```

`wcwidth()` and its string version, `wcswidth()` are defined by IEEE Std
1002.1-2001, a.k.a. POSIX.1-2001, and return the number of columns used
to represent the given wide character and string.

Markus's implementation assumes the wide character given to those
functions to be encoded in ISO 10646, which is almost true for
JavaScript's characters.

## More

The following is from the original version by Markus Kuhn [wcwidth.c](https://www.cl.cam.ac.uk/~mgk25/ucs/wcwidth.c)

This is an implementation of wcwidth() and wcswidth() (defined in
IEEE Std 1002.1-2001) for Unicode.

http://www.opengroup.org/onlinepubs/007904975/functions/wcwidth.html  
http://www.opengroup.org/onlinepubs/007904975/functions/wcswidth.html  

In fixed-width output devices, Latin characters all occupy a single
"cell" position of equal width, whereas ideographic CJK characters
occupy two such cells. Interoperability between terminal-line
applications and (teletype-style) character terminals using the
UTF-8 encoding requires agreement on which character should advance
the cursor by how many cell positions. No established formal
standards exist at present on which Unicode character shall occupy
how many cell positions on character terminals. These routines are
a first attempt of defining such behavior based on simple rules
applied to data provided by the Unicode Consortium.

For some graphical characters, the Unicode standard explicitly
defines a character-cell width via the definition of the East Asian
FullWidth (F), Wide (W), Half-width (H), and Narrow (Na) classes.
In all these cases, there is no ambiguity about which width a
terminal shall use. For characters in the East Asian Ambiguous (A)
class, the width choice depends purely on a preference of backward
compatibility with either historic CJK or Western practice.
Choosing single-width for these characters is easy to justify as
the appropriate long-term solution, as the CJK practice of
displaying these characters as double-width comes from historic
implementation simplicity (8-bit encoded characters were displayed
single-width and 16-bit ones double-width, even for Greek,
Cyrillic, etc.) and not any typographic considerations.

Much less clear is the choice of width for the Not East Asian
(Neutral) class. Existing practice does not dictate a width for any
of these characters. It would nevertheless make sense
typographically to allocate two character cells to characters such
as for instance EM SPACE or VOLUME INTEGRAL, which cannot be
represented adequately with a single-width glyph. The following
routines at present merely assign a single-cell width to all
neutral characters, in the interest of simplicity. This is not
entirely satisfactory and should be reconsidered before
establishing a formal standard in this area. At the moment, the
decision which Not East Asian (Neutral) characters should be
represented by double-width glyphs cannot yet be answered by
applying a simple rule from the Unicode database content. Setting
up a proper standard for the behavior of UTF-8 character terminals
will require a careful analysis not only of each Unicode character,
but also of each presentation form, something the author of these
routines has avoided to do so far.

## License

**MIT**  
Previous projects were MIT licensed (included in LICENSE) and the [original c code](https://www.cl.cam.ac.uk/~mgk25/ucs/wcwidth.c) was very permissive.
