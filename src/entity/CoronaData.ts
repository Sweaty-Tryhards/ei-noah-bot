import {
  BaseEntity, Entity, PrimaryKey, Property,
} from '@mikro-orm/core';

export interface CoronaInfo {
  Date_of_publication: string
  Municipality_name: string
  Province: string
  Total_reported: number
  Hospital_admission: number
  Deceased: number
}

@Entity()
class CoronaData extends BaseEntity<CoronaData, 'id'> {
  constructor(coronaInfo : CoronaInfo) {
    super();
    this.community = coronaInfo.Municipality_name;
    this.totalReported = coronaInfo.Total_reported;
    this.hospitalAdmissions = coronaInfo.Hospital_admission;
    this.deceased = coronaInfo.Deceased;

    this.date = new Date(coronaInfo.Date_of_publication);
  }

  @PrimaryKey()
  id!: number;

  @Property({ unique: 'dateCommunity' })
  date!: Date;

  @Property({ unique: 'dateCommunity' })
  community!: string;

  @Property()
  totalReported!: number;

  @Property()
  hospitalAdmissions!: number;

  @Property()
  deceased!: number;
}

export default CoronaData;
