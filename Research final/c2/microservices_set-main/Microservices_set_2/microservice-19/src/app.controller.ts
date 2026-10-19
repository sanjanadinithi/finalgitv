import { Controller, Get, Query, Req, Res, Next } from '@nestjs/common';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  private track(res: any, t0: number) {
    this.appService.processing++;
    this.appService.lastLatencyMs = Date.now() - t0;
    if (res.statusCode >= 400) this.appService.errors++;
  }

  @Get()
  getHello(@Res() res: any): any {
    this.appService.incoming++;
    const t0 = Date.now();
    res.send(this.appService.getHello());
    this.track(res, t0);
  }

  @Get('ping')
  ping(@Res() res: any): any {
    this.appService.incoming++;
    const t0 = Date.now();
    res.json(this.appService.ping());
    this.track(res, t0);
  }

  @Get('health')
  health(@Res() res: any): any {
    this.appService.incoming++;
    const t0 = Date.now();
    res.json(this.appService.health());
    this.track(res, t0);
  }

  @Get('metrics')
  metrics(@Res() res: any): any {
    this.appService.incoming++;
    const t0 = Date.now();
    res.json(this.appService.metrics());
    this.track(res, t0);
  }

  @Get('spike')
  spike(@Query('duration') duration: string, @Res() res: any): any {
    this.appService.incoming++;
    const t0 = Date.now();
    const d = parseInt(duration ?? '10', 10) || 10;
    res.json(this.appService.spike(d));
    this.track(res, t0);
  }
}
