import { BadRequestException } from '@nestjs/common';
import { BooksController } from './books.controller';

describe('BooksController', () => {
  const details = { get: jest.fn() };
  const controller = new BooksController(details);

  it('rejects a non-numeric Qidian book id before requesting details', () => {
    expect(() => controller.get('qidian', 'abc')).toThrow(BadRequestException);
    expect(details.get).not.toHaveBeenCalled();
  });
});
